import { classifyError, createBackoff } from './worker/retry.mjs';
export { classifyError, createBackoff } from './worker/retry.mjs';
import {approvedMatchUser} from './match-pairing.mjs';
import {isLiveCheckpoint} from './live-checkpoint.mjs';
import {createIdleCache} from './idle-cache.mjs';
import {archiveOldMatchSelections,matchReceiptStorageReady,deleteUnselectedOldMatches} from './match-receipts.mjs';
// The brain of the worker (scripts/worker.mjs): finds finished matches, builds the post for every customer who picked the
// match and sends it to their approved Telegram chat. Its external dependencies (database,
// match data, render server, Telegram, the clock) is handed in, so tests can replace all of it.
//
// Rules (same as the n8n workflow it replaced):
//   - wait 107 min after kickoff, give up after 24 h
//   - status check = 1 request per day list; events = 1 request per finished match; the result is shared by all customers
//   - unselected shared Match rows are deleted after 48 h; Selection receipts stay until a receipt archive is approved
//
// What this version adds on top, and why (each point has a test in tests/worker-core.test.ts):
//   1. A failing status check or events download no longer stops the whole round: posts that are ready are still sent.
//   2. A failing API call is retried with a growing pause (not every minute), so it cannot use up the free daily quota.
//   3. A render server or Telegram that is just unreachable (not running, network down, "too many requests") does not
//      use up the 5 attempts of a post: it waits and tries again, until the 24 h are over.
//   4. If the post was delivered but saving "COMPLETED" failed (database asleep), it is never sent a second time.
//   5. A match that ended with goals but came back with no events is looked up again a few times before the post is
//      made without scorers (the data provider is sometimes a few minutes late).
//   6. A post that could not be made within 24 h is closed and the customer is told, instead of waiting silently.
//   7. Posts stuck in SENDING (crash, database down) are put back in the queue after 15 minutes, not only at start-up.

const minutes = (n) => n * 60e3;
const hours = (n) => n * 3600e3;

export function createWorkerCore(deps) {
  const {
    prisma,
    football, // { refreshStatuses, fetchEvents, saveEvents, isFinished, isDead }
    buildEventsHtml,
    renderPost,
    brandLookFields,
    pickBackground, // (sel, brand) => { background_path } | { background_data_uri }
    telegramForUser, // (user) => { sendMessage, sendDocument }
    unlink,
    cleanupMatchArtifacts = async () => {},
    cleanupMatchHtml = async () => {},
    storageMaintenance,
    localDate,
    config, // CHECK_INTERVAL_MIN, CLEANUP_AFTER_HOURS, DELAY_MINUTES, MAX_AGE_HOURS, MAX_ATTEMPTS, RETRY_DELAY_MIN
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = console.log,
    error = console.error,
    isActive = () => true,
  } = deps;
  const assertActive=()=>{if(!isActive())throw Object.assign(new Error("MATCH_WORKER_LOCK_LOST"),{code:"MATCH_WORKER_LOCK_LOST"});};
  const activeClaims=new Set();
  let cleanupAfterFixtureId=null;
  const { isFinished, isDead } = football;
  const EMPTY_EVENTS_TRIES = deps.emptyEventsTries ?? 3;

  // Normal checks may run every minute; API failures retain the existing 10-minute initial backoff.
  const statusBackoff = createBackoff({ baseMs: minutes(Math.max(10, config.CHECK_INTERVAL_MIN)), maxMs: minutes(60) });
  const eventsBackoff = createBackoff({ baseMs: minutes(5), maxMs: minutes(30) });
  const sendBackoff = createBackoff({ baseMs: minutes(1), maxMs: minutes(10) });
  const emptyEvents = new Map(); // fixtureId -> how many times the events came back empty
  const deliveredButUnsaved = new Map(); // selectionId -> time (post is out, only the database note is missing)
  const liveSnapshots=createIdleCache({max:128,ttlMs:hours(1),now});

  // Sends a plain message to the customer through THEIR bot; never lets a Telegram error stop the worker.
  async function notify(user, text) {
    assertActive();
    try {
      const approved=await approvedMatchUser(prisma,user.id,{botId:user.botId,connectionToken:user.botToken,memberVersion:user.accessVersion,identity:{chatId:user.telegramChatId,telegramUserId:user.telegramChatId}});
      if(approved)await telegramForUser(approved).sendMessage(approved.telegramChatId, text);
    } catch (e) {
      error("notify failed:", e.message);
    }
  }

  // A customer-made template lives in the database: its html is sent along with the render request.
  // If it was deleted in the meantime, the post is drawn with Classic.
  async function customTemplateFields(brand) {
    const ref = brand?.templateRef ?? "";
    if (!ref.startsWith("custom:")) return {};
    const t = await prisma.template.findFirst({ where: { id: ref.slice("custom:".length), userId: brand.userId }, select: { html: true } });
    return t ? { template: "classic", template_html: t.html } : { template: "classic" };
  }

  async function sendOne(sel, match, eventsHtml, stage = 'final') {
    assertActive();
    const scope={botId:sel.user.botId,connectionToken:sel.user.botToken,memberVersion:sel.user.accessVersion,identity:{chatId:sel.user.telegramChatId,telegramUserId:sel.user.telegramChatId}};
    if(!await approvedMatchUser(prisma,sel.user.id,scope))throw Object.assign(new Error('Match pairing required'),{code:'MATCH_PAIRING_REQUIRED'});
    const brand = sel.user.brands[0];
    const jpg = await renderPost({
      fixture_id: `${match.fixtureId}_${sel.id}${stage === 'live' ? '_live' : ''}`, // keep final paths stable; live cannot overwrite them
      ...(await brandLookFields(brand)),
      ...(await customTemplateFields(brand)),
      ...(await pickBackground(sel, brand)),
      league_id: match.leagueId,
      league_logo: match.leagueLogo,
      home_team_id: match.homeTeamId,
      away_team_id: match.awayTeamId,
      home_logo: match.homeLogo,
      away_logo: match.awayLogo,
      home_team: match.homeTeam,
      away_team: match.awayTeam,
      home_score: match.homeScore,
      away_score: match.awayScore,
      ...eventsHtml,
    },{userId:sel.user.id,owner:sel.user.accessVersion===undefined});
    // The unique HTML source is no longer needed after Chromium returns the image.
    // The file helper remains dry-run until the owner approves activation.
    await cleanupMatchHtml(jpg).catch(() => {});
    assertActive();
    const approved=await approvedMatchUser(prisma,sel.user.id,scope);
    if(!approved)throw Object.assign(new Error('Match pairing required'),{code:'MATCH_PAIRING_REQUIRED'});
    const telegram = telegramForUser(approved);
    const live = stage === 'live';
    const field = live ? 'liveDispatchAt' : 'finalDispatchAt';
    // Persist BEFORE external delivery. Telegram has no idempotency key: a timeout or crash after
    // dispatch is ambiguous, so recovery must not blindly send again.
    const fenced = await prisma.selection.updateMany({ where: { id: sel.id,
      status: live ? 'SELECTED' : 'SENDING', ...(live ? {liveStatus:'SENDING'} : {}), [field]: null },
      data: { [field]: new Date(now()) } });
    if (!fenced.count) throw Object.assign(new Error('Delivery claim lost'), {code:'DELIVERY_CLAIM_LOST'});
    assertActive();
    const label = live ? `90+ Live Checkpoint (${match.elapsed}${match.extra ? '+'+match.extra : ''} min)` : 'Full Time';
    if(!await approvedMatchUser(prisma,sel.user.id,scope))throw Object.assign(new Error('Match pairing required'),{code:'MATCH_PAIRING_REQUIRED'});
    try {
      await telegram.sendDocument(approved.telegramChatId, jpg, `${label} — ${match.homeTeam} ${match.homeScore}-${match.awayScore} ${match.awayTeam}`,undefined,{beforeDispatch:async()=>{
        assertActive();if(!await approvedMatchUser(prisma,sel.user.id,scope))throw Object.assign(new Error('Match pairing required'),{code:'MATCH_PAIRING_REQUIRED',deliveryNotAttempted:true});
      }});
      // Telegram confirmed acceptance. The path is unique to this render; cleanup errors
      // must never turn a delivered post into a retry or alter its delivery fence.
      await cleanupMatchArtifacts(jpg).catch(() => {});
    } catch (e) {
      // Only an explicit Telegram rejection proves the document was not accepted.
      if (e.deliveryNotAttempted || Number.isInteger(e.telegramCode) || /^Telegram sendDocument failed: (?:Forbidden|Bad Request|Too Many Requests)/i.test(e.message)) {
        await prisma.selection.update({where:{id:sel.id},data:{[field]:null}});
      } else {
        e.deliveryUncertain = true;
      }
      throw e;
    }
  }

  // The post is out; record it. A few quick retries, because a sleeping database often answers the second time.
  async function markCompleted(sel) {
    let lastError;
    for (let i = 0; i < 3; i++) {
      try {
        await prisma.selection.update({ where: { id: sel.id }, data: { status: "COMPLETED", sentAt: new Date(now()) } });
        return true;
      } catch (e) {
        lastError = e;
        await sleep(500 * (i + 1));
      }
    }
    error(`[warning] post ${sel.id} was delivered but could not be saved as COMPLETED (${lastError?.message}); it will not be sent again`);
    return false;
  }

  // Tries again to save posts that were delivered while the database was not answering.
  async function savePendingCompletions() {
    for (const id of [...deliveredButUnsaved.keys()]) {
      try {
        await prisma.selection.update({ where: { id }, data: { status: "COMPLETED", sentAt: new Date(deliveredButUnsaved.get(id)) } });
        deliveredButUnsaved.delete(id);
      } catch (e) {
        if (e?.code === "P2025") deliveredButUnsaved.delete(id); // the selection is gone (customer deleted it): nothing to save
      }
    }
  }

  async function tick() {
    assertActive();
    const t = now();
    await savePendingCompletions();

    const candidates = await prisma.selection.findMany({
      where: {
        status: "SELECTED",
        match: { kickoff: { gte: new Date(t - hours(config.MAX_AGE_HOURS)), lte: new Date(t - minutes(config.DELAY_MINUTES)) } },
      },
      include: { match: true, user: { include: { brands: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    });
    const sels=[];
    const authorized=new Map();
    for(const sel of candidates){
      if(!authorized.has(sel.user.id))authorized.set(sel.user.id,await approvedMatchUser(prisma,sel.user.id));
      const approved=authorized.get(sel.user.id);
      if(approved)sels.push({...sel,user:{...sel.user,...approved}});
    }
    if (!sels.length) return;
    // Stable priority changes only contention between users, never match eligibility/timing.
    sels.sort((a,b)=>Number(a.user.accessVersion!==undefined)-Number(b.user.accessVersion!==undefined));

    // 1) Status check, once per day list, only if some match is due for a look.
    const due = new Map();
    for (const s of sels) {
      const m = s.match;
      if (m.finishedAt || isFinished(m.statusShort) || isDead(m.statusShort)) continue;
      if (m.lastCheckedAt && t - m.lastCheckedAt.getTime() < minutes(config.CHECK_INTERVAL_MIN)) continue;
      due.set(m.fixtureId, m);
    }
    const byDay = new Map();
    for (const m of due.values()) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
    for (const [day, list] of byDay) {
      if (!statusBackoff.ready(day, t)) continue;
      try {
        await football.refreshStatuses(day, list);
        statusBackoff.ok(day);
      } catch (e) {
        const pause = statusBackoff.fail(day, t);
        error(`[status check failed] day ${day}: ${e.message} (next try in ${Math.round(pause / 60e3)} min)`);
      }
    }

    // 2) Events for every finished match that does not have them yet (shared by all customers).
    const ids = [...new Set(sels.map((s) => s.fixtureId))];
    let matches = await prisma.match.findMany({ where: { fixtureId: { in: ids } } });
    let eventsSaved=false;
    for (const m of matches) {
      if (!isFinished(m.statusShort) || m.eventsJson) continue;
      const key = String(m.fixtureId);
      if (!eventsBackoff.ready(key, t)) continue;
      try {
        const events = await football.fetchEvents(m.fixtureId);
        const goals = (m.homeScore ?? 0) + (m.awayScore ?? 0);
        if (events.length === 0 && goals > 0) {
          const tries = (emptyEvents.get(m.fixtureId) ?? 0) + 1;
          emptyEvents.set(m.fixtureId, tries);
          if (tries < EMPTY_EVENTS_TRIES) {
            eventsBackoff.wait(key, t, minutes(5));
            log(`[events] ${m.homeTeam} - ${m.awayTeam}: finished ${m.homeScore}-${m.awayScore} but no events yet (look ${tries}/${EMPTY_EVENTS_TRIES}), trying again in 5 min`);
            continue;
          }
        }
        await football.saveEvents(m.fixtureId, events);
        eventsSaved=true;
        emptyEvents.delete(m.fixtureId);
        eventsBackoff.ok(key);
      } catch (e) {
        const pause = eventsBackoff.fail(key, t);
        error(`[events failed] ${m.homeTeam} - ${m.awayTeam}: ${e.message} (next try in ${Math.round(pause / 60e3)} min)`);
      }
    }
    if(eventsSaved)matches = await prisma.match.findMany({ where: { fixtureId: { in: ids } } });
    const matchById = new Map(matches.map((m) => [m.fixtureId, m]));
    const htmlCache = new Map();

    // 3) Build + send for each customer (one at a time: the render server is heavy).
    for (const sel of sels) {
      const match = matchById.get(sel.fixtureId);
      if (!match) continue;

      if (isDead(match.statusShort)) {
        await prisma.selection.update({ where: { id: sel.id }, data: { status: "FAILED", lastError: `match ${match.statusShort}` } });
        await notify(sel.user, `${match.homeTeam} - ${match.awayTeam} was postponed or cancelled, so there is no post.`);
        continue;
      }
      if (!isFinished(match.statusShort) || !match.eventsJson) continue;
      if (sel.attempts > 0 && t - sel.updatedAt.getTime() < minutes(config.RETRY_DELAY_MIN)) continue;
      if (!sendBackoff.ready(sel.id, t)) continue;

      assertActive();
      const claimed = await prisma.selection.updateMany({ where: { id: sel.id, status: "SELECTED" }, data: { status: "SENDING" } });
      if (claimed.count === 0) continue;

      activeClaims.add(sel.id);
      let delivered = false;
      try {
        if (!htmlCache.has(match.fixtureId)) {
          htmlCache.set(
            match.fixtureId,
            buildEventsHtml(match.eventsJson, {
              home_team_id: match.homeTeamId,
              away_team_id: match.awayTeamId,
              home_team: match.homeTeam,
              away_team: match.awayTeam,
              home_score: match.homeScore,
              away_score: match.awayScore,
            }),
          );
        }
        await sendOne(sel, match, htmlCache.get(match.fixtureId));
        delivered = true;
        sendBackoff.ok(sel.id);
        if (!(await markCompleted(sel))) deliveredButUnsaved.set(sel.id, t);
        log(`[sent] ${match.homeTeam} - ${match.awayTeam} -> ${sel.user.email}`);
      } catch (e) {
        if (!isActive()) throw e;
        if (delivered) continue; // cannot happen (markCompleted does not throw); kept so a post is never repeated
        if(e.code === 'DELIVERY_CLAIM_LOST') continue;
        if(e.deliveryUncertain){
          await prisma.selection.update({where:{id:sel.id},data:{status:'FAILED',lastError:'Telegram final delivery unconfirmed; automatic resend suppressed.'}});
          continue;
        }
        if(e?.code==='MATCH_PAIRING_REQUIRED'){
          if(sel.user.accessVersion!==undefined)continue;
          await prisma.selection.update({where:{id:sel.id},data:{status:'SELECTED'}});continue;
        }
        const label = `${match.homeTeam} - ${match.awayTeam} -> ${sel.user.email}`;
        if (classifyError(e) === "transient") {
          // Nobody's fault: the attempt does not count. Wait and try again (the 24 h limit ends it for good).
          const pause = sendBackoff.fail(sel.id, t);
          error(`[waiting] ${label}: ${e.message} (will try again in ${Math.round(pause / 60e3)} min)`);
          await prisma.selection.update({ where: { id: sel.id }, data: { status: "SELECTED", lastError: String(e.message).slice(0, 500) } });
          continue;
        }
        const attempts = sel.attempts + 1;
        const failed = attempts >= config.MAX_ATTEMPTS;
        error(`[error] ${label} (attempt ${attempts}):`, e.message);
        await prisma.selection.update({
          where: { id: sel.id },
          data: { status: failed ? "FAILED" : "SELECTED", attempts, lastError: String(e.message).slice(0, 500) },
        });
        if (failed) await notify(sel.user, `Sorry, the post for ${match.homeTeam} - ${match.awayTeam} could not be created.`);
      } finally { activeClaims.delete(sel.id); }
    }

    // Final deliveries above always take priority. Live uses only the frozen first scheduled
    // observation; live event data is never saved as the final event cache.
    const liveHtmlCache = new Map();
    for (const sel of sels) {
      const match = matchById.get(sel.fixtureId);
      const shot = match?.liveCheckpointJson;
      if (!match || !isLiveCheckpoint(match.statusShort, match.elapsedMinutes) || !shot ||
          !isLiveCheckpoint(shot.statusShort, shot.elapsed) ||
          !Number.isInteger(shot.homeScore) || shot.homeScore < 0 || !Number.isInteger(shot.awayScore) || shot.awayScore < 0 ||
          !match.liveCheckpointAt || (sel.selectedAt ?? sel.createdAt) > match.liveCheckpointAt ||
          !['PENDING',undefined].includes(sel.liveStatus) || sel.liveDispatchAt) continue;
      if (sel.liveUpdatedAt && t - sel.liveUpdatedAt.getTime() < minutes(config.RETRY_DELAY_MIN)) continue;
      const claimed = await prisma.selection.updateMany({where:{id:sel.id,status:'SELECTED',liveStatus:'PENDING',liveDispatchAt:null},
        data:{liveStatus:'SENDING',liveUpdatedAt:new Date(t)}});
      if (!claimed.count) continue;
      try {
        const snapshotKey=JSON.stringify([match.fixtureId,shot,match.homeTeamId,match.awayTeamId,match.homeTeam,match.awayTeam]);
        const cached=liveSnapshots.get(snapshotKey);
        if(cached)liveHtmlCache.set(match.fixtureId,cached);
        if (!liveHtmlCache.has(match.fixtureId)) {
          let events = [];
          try {
            events = await football.fetchEvents(match.fixtureId);
          } catch (e) {
            // Missing provider details must not postpone the existing live delivery.
            error(`[live events failed] fixture ${match.fixtureId}: ${e.message}`);
          }
          // Retries retain the frozen checkpoint score, so exclude later playing-time events.
          const available = (Array.isArray(events) ? events : []).filter(ev => {
            const minute = ev?.time?.elapsed;
            return Number.isInteger(minute) && (minute < shot.elapsed ||
              (minute === shot.elapsed && (ev.time.extra ?? 0) <= (shot.extra ?? 0)));
          });
          liveHtmlCache.set(match.fixtureId, buildEventsHtml(available, {
            home_team_id:match.homeTeamId, away_team_id:match.awayTeamId,
            home_team:match.homeTeam, away_team:match.awayTeam,
            home_score:shot.homeScore, away_score:shot.awayScore,
          }));
          // Reuse only complete named scoring snapshots; incomplete provider data is retried.
          const goals=available.filter(e=>String(e.type).toLowerCase()==='goal'&&!/cancel|disallow|missed/i.test(e.detail??'')&&!/shootout/i.test(e.comments??''));
          if(available.length&&goals.length===shot.homeScore+shot.awayScore&&goals.every(e=>e.player?.name))liveSnapshots.set(snapshotKey,liveHtmlCache.get(match.fixtureId));
        }
        await sendOne(sel, {...match,...shot}, liveHtmlCache.get(match.fixtureId), 'live');
        await prisma.selection.update({where:{id:sel.id},data:{liveStatus:'SENT',liveSentAt:new Date(now()),liveLastError:null}});
      } catch(e) {
        if (!isActive()) throw e;
        if (e.code === 'DELIVERY_CLAIM_LOST') continue;
        // A persisted fence also covers successful delivery followed by a failed SENT write.
        const current = await prisma.selection.findUnique({where:{id:sel.id}});
        if (!current) continue;
        const attempts = (sel.liveAttempts ?? 0) + (classifyError(e) === 'transient' || e.code === 'MATCH_PAIRING_REQUIRED' ? 0 : 1);
        await prisma.selection.update({where:{id:sel.id},data:{
          liveStatus:current.liveDispatchAt ? 'UNCERTAIN' : attempts >= config.MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          liveAttempts:attempts,liveUpdatedAt:new Date(t),liveLastError:current.liveDispatchAt ? 'Telegram live delivery unconfirmed; automatic resend suppressed.' : String(e.message).slice(0,500),
        }});
      }
    }
  }

  // Posts whose 24 hours are over without a result: close them and tell the customer (instead of waiting silently).
  async function expireOld() {
    assertActive();
    const t = now();
    const old = await prisma.selection.findMany({
      where: {
        status: "SELECTED",
        match: { kickoff: { lt: new Date(t - hours(config.MAX_AGE_HOURS)) } },
      },
      include: { match: true, user: true },
    });
    for (const sel of old) {
      assertActive();
      const approved=await approvedMatchUser(prisma,sel.user.id);
      if(!approved)continue;
      await prisma.selection.update({ where: { id: sel.id }, data: { status: "FAILED", lastError: `gave up after ${config.MAX_AGE_HOURS} h without a result` } });
      await notify(approved, `We could not get the final result of ${sel.match.homeTeam} - ${sel.match.awayTeam} in time, so there is no post.`);
    }
    if (old.length) log(`[expired] ${old.length} posts closed after ${config.MAX_AGE_HOURS} h`);
  }

  // Recover only stale SENDING rows, including at startup. Never recover a current or known-delivered claim.
  async function recoverStuck({ all = false } = {}) {
    assertActive();
    const where = { status: "SENDING", finalDispatchAt:null, updatedAt: { lt: new Date(now() - minutes(15)) }, id: { notIn: [...deliveredButUnsaved.keys(),...activeClaims] } };
    const r = await prisma.selection.updateMany({ where, data: { status: "SELECTED" } });
    // Crashes before dispatch can retry. Crashes after dispatch require manual reconciliation.
    await prisma.selection.updateMany({where:{liveStatus:'SENDING',liveDispatchAt:null,liveUpdatedAt:{lt:new Date(now()-minutes(15))}},data:{liveStatus:'PENDING'}});
    await prisma.selection.updateMany({where:{liveStatus:'SENDING',liveDispatchAt:{not:null},liveUpdatedAt:{lt:new Date(now()-minutes(15))}},data:{liveStatus:'UNCERTAIN',liveLastError:'Dispatch interrupted; automatic resend suppressed.'}});
    await prisma.selection.updateMany({where:{status:'SENDING',finalDispatchAt:{not:null},updatedAt:{lt:new Date(now()-minutes(15))},id:{notIn:[...deliveredButUnsaved.keys(),...activeClaims]}},data:{status:'FAILED',lastError:'Dispatch interrupted; automatic resend suppressed.'}});
    if (r.count) log(`[recovered] ${r.count} posts put back in the queue`);
    return r.count;
  }

  // Daily housekeeping: the shared match table does not grow forever.
  async function cleanup() {
    assertActive();
    const t = now();
    const candidates=()=>prisma.match.findMany({
      where: { kickoff: { lt: new Date(t - hours(config.CLEANUP_AFTER_HOURS)) },...(cleanupAfterFixtureId===null?{}:{fixtureId:{gt:cleanupAfterFixtureId}}) },
      select: { fixtureId: true },orderBy:{fixtureId:'asc'},take:50,
    });
    let old=await candidates();
    if(!old.length&&cleanupAfterFixtureId!==null){cleanupAfterFixtureId=null;old=await candidates();}
    // Advance past retained/unresolved rows too; otherwise the same first 50 rows
    // could indefinitely starve safe cleanup of every later fixture. Restart wraps safely.
    cleanupAfterFixtureId=old.length?old[old.length-1].fixtureId:null;
    if (old.length) {
      const ids = old.map((m) => m.fixtureId);
      const retainedSelections = await prisma.selection.findMany({ where: { fixtureId: { in: ids } }, select: { fixtureId: true } });
      const hasReceipt = new Set(retainedSelections.map(s => s.fixtureId));
      const removable = ids.filter(id => !hasReceipt.has(id));
      const removed=await deleteUnselectedOldMatches(prisma,removable,new Date(t-hours(config.CLEANUP_AFTER_HOURS)));
      let archived = 0, cleanedSelections = 0, held = ids.length - removed;
      let receiptReady = false;
      if (held) {
        try { receiptReady = await matchReceiptStorageReady(prisma); }
        catch (e) { error('[cleanup] receipt storage unavailable; matched records retained:', e.message); }
      }
      if (receiptReady) for (const fixtureId of [...hasReceipt]) {
        assertActive();
        try {
          const result = await archiveOldMatchSelections(prisma, fixtureId, new Date(t - hours(config.CLEANUP_AFTER_HOURS)), t);
          archived += result.archived;
          cleanedSelections += result.deletedSelections;
          if (result.deletedMatch) held--;
        } catch (e) { error('[cleanup] receipt archive failed; fixture retained:', e.message); }
      }
      log(`[cleanup] removed ${ids.length-held} matches older than ${config.CLEANUP_AFTER_HOURS} h; archived ${archived} receipts; removed ${cleanedSelections} terminal selections; retained ${held} unresolved matches`);
    }
    const cutoffDay = localDate(new Date(t - hours(72)));
    const days = await prisma.fixtureDay.findMany({
      where: { OR: [{date:{lt:cutoffDay}}, {date:{gte:'utc:',lt:'utc:'+cutoffDay}}] }, select:{date:true}, take:50,
    });
    const expired = days.filter(({date}) => {
      const parsed = /^(?:([0-9]{4}-[0-9]{2}-[0-9]{2})|utc:([0-9]{4}-[0-9]{2}-[0-9]{2})\|[0-9]+(?:,[0-9]+)*(?:\|coverage-v1)?)$/.exec(date);
      const day = parsed?.[1] ?? parsed?.[2];
      if (!day || day >= cutoffDay) return false;
      const value = new Date(day+'T00:00:00.000Z');
      return Number.isFinite(value.getTime()) && value.toISOString().slice(0,10) === day;
    }).map(({date}) => date);
    if (expired.length) await prisma.fixtureDay.deleteMany({where:{date:{in:expired.slice(0,50)}}});
    const oldUsage = await prisma.apiUsage.findMany({where:{day:{lt:new Date(t-hours(24*7)).toISOString().slice(0,10)}},select:{day:true},take:50});
    if (oldUsage.length) await prisma.apiUsage.deleteMany({where:{day:{in:oldUsage.map(row=>row.day)}}});

    if (storageMaintenance) {
      try {
        const report = await storageMaintenance.runStorageMaintenance({ prisma, now: t, includeNewsTemp: false, rendererExclusive: false, log });
        const capacity = await storageMaintenance.measureStorageCapacity({ prisma, warn: message => log(message) });
        if (report.mode === 'dry-run' && (report.files.length || report.database.expiredSessions.length || report.database.expiredPairingChallenges.length || report.database.expiredInactiveNewsConversations.length || report.database.expiredMatchDeliveryReceipts.length)) {
          log(`[maintenance dry-run] candidates: files=${report.files.length}, sessions=${report.database.expiredSessions.length}, challenges=${report.database.expiredPairingChallenges.length}, newsStates=${report.database.expiredInactiveNewsConversations.length}, matchReceipts=${report.database.expiredMatchDeliveryReceipts.length}`);
        }
        void capacity;
      } catch (e) { error('[maintenance] report unavailable; no cleanup was applied:', e.message); }
    }
    const pending=await prisma.selection.findMany({where:{status:{in:['SELECTED','SENDING']}},select:{id:true,fixtureId:true}});
    const liveIds=new Set(pending.map(s=>s.fixtureId));
    const tracked=await prisma.match.findMany({where:{fixtureId:{in:[...liveIds]}},select:{day:true}});
    statusBackoff.retire(new Set(tracked.map(m=>m.day)),t);
    eventsBackoff.retire(new Set([...liveIds].map(String)),t);
    sendBackoff.retire(new Set(pending.map(s=>s.id)),t);
    for(const id of emptyEvents.keys())if(!liveIds.has(id))emptyEvents.delete(id);
    // deliveredButUnsaved and activeClaims are safety state, not disposable caches. Never expire them here.
  }

  return { tick, expireOld, recoverStuck, cleanup, notify, _state: { deliveredButUnsaved, emptyEvents } };
}
