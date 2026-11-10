// Ported 1:1 from the n8n "Build Events HTML" node.
// Input: raw API-Football events array + { home_team, away_team, home_score, away_score }.
// Output: { home_events_html, away_events_html, total_events }.

const MAX_ROWS_PER_SIDE = 5;

// თუ ავტოგოლის გუნდს ვერ ვადგენთ ანგარიშით (ორივე გუნდს ერთნაირი
// რაოდენობა აქვს), ეს მნიშვნელობა გადაწყვეტს:
//   true  = API-ში ავტოგოლის team არის იმ მოთამაშის გუნდი, ვინც გაიტანა
//   false = API-ში ავტოგოლის team არის გუნდი, ვისაც გოლი ჩაეწერა
const DEFAULT_OWN_GOAL_TEAM_IS_SCORER_TEAM = true;

// ავტოგოლის აიქონის ფერი
const OG_COLOR = '#ee5a5a';

export function buildEventsHtml(rawEvents, match = {}) {
match = match && typeof match === 'object' ? match : {};
let events = (Array.isArray(rawEvents) ? rawEvents : []).filter(ev => ev && typeof ev === 'object');

function norm(s) {
    return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
    ));
}

function abbreviate(fullName) {
    const name = String(fullName ?? '').trim();
    const parts = name.split(/\s+/);
    if (parts.length < 2) return name;
    return `${Array.from(parts[0])[0]}. ${parts.slice(1).join(' ')}`;
}

function elapsedOf(ev) {
    const raw = ev.time?.elapsed;
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

function extraOf(ev) {
    const n = Number(ev.time?.extra);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function minuteLabel(ev) {
    const extra = extraOf(ev);
    return String(elapsedOf(ev)) + (extra ? '+' + extra : '');
}

function sortValue(ev) {
    return elapsedOf(ev) * 1000 + extraOf(ev);
}

function playerKey(ev) {
    const id = ev.player?.id;
    if (id !== null && id !== undefined && id !== '') return 'id:' + id;
    return 'name:' + norm(ev.player?.name);
}

// ---------------------------------------------------------------------
//  ტიპების ამოცნობა (დიდი/პატარა ასოები და ზედმეტი ადგილები არ ითვლება)
// ---------------------------------------------------------------------

// პენალტების სერია (მატჩის შემდეგ) სურათზე არ გვჭირდება
function isShootout(ev) {
    return norm(ev.comments).includes('shootout');
}

// ანულირებული / გაუქმებული გოლი
function isCancelledGoal(ev) {
    const d = norm(ev.detail);
    return d.includes('cancel') || d.includes('disallow');
}

function isMissedPenalty(ev) {
    const d = norm(ev.detail);
    return d.includes('missed') && d.includes('penalty');
}

function isScoredPenalty(ev) {
    return norm(ev.detail).includes('penalty') && !isMissedPenalty(ev);
}

function isOwnGoal(ev) {
    return norm(ev.detail).includes('own goal');
}

// რეალური გოლი, რომელიც ანგარიშში ითვლება (აცდენილი პენალტის გარეშე)
function isCountedGoal(ev) {
    return norm(ev.type) === 'goal'
        && !isShootout(ev)
        && !isCancelledGoal(ev)
        && !isMissedPenalty(ev);
}

function isYellowCard(ev) {
    return norm(ev.type) === 'card' && norm(ev.detail) === 'yellow card';
}

const SECOND_YELLOW_RE = /second yellow|2nd yellow|yellow.?red/;

function isRedCardEvent(ev) {
    if (norm(ev.type) !== 'card') return false;
    const d = norm(ev.detail);
    return d.includes('red') || SECOND_YELLOW_RE.test(d);
}

// ---------------------------------------------------------------------
//  მეორე ყვითლის ამოცნობა
//  1) API პირდაპირ წერს "Second Yellow card" / "2nd yellow" / "yellow/red"
//  2) API ერთსა და იმავე წუთზე იმავე ფეხბურთელს წერს Yellow Card + Red Card
// ---------------------------------------------------------------------

const yellowMoments = new Set(
    events
        .filter(ev => isYellowCard(ev) || (isRedCardEvent(ev) && SECOND_YELLOW_RE.test(norm(ev.detail))))
        .filter(ev => elapsedOf(ev) !== null && playerKey(ev) !== 'name:')
        .map(ev => `${ev.team?.id ?? norm(ev.team?.name)}|${playerKey(ev)}|${elapsedOf(ev)}|${extraOf(ev)}`)
);

function isSecondYellow(ev) {
    if (SECOND_YELLOW_RE.test(norm(ev.detail))) return true;
    if (elapsedOf(ev) === null) return false;
    return yellowMoments.has(`${ev.team?.id ?? norm(ev.team?.name)}|${playerKey(ev)}|${elapsedOf(ev)}|${extraOf(ev)}`);
}

// ---------------------------------------------------------------------
//  კატეგორია
// ---------------------------------------------------------------------

function categoryFor(ev) {
    if (norm(ev.type) === 'goal') {
        if (isShootout(ev) || isCancelledGoal(ev)) return null;
        if (isMissedPenalty(ev)) return 'goal-missed';
        if (isOwnGoal(ev)) return 'goal-own';
        if (isScoredPenalty(ev)) return 'goal-penalty';
        return 'goal-normal';
    }
    if (isRedCardEvent(ev)) return isSecondYellow(ev) ? 'card-second-yellow' : 'card-red';
    return null;
}

// ---------------------------------------------------------------------
//  გუნდის მხარე
// ---------------------------------------------------------------------

const homeName = norm(match.home_team);
const awayName = norm(match.away_team);

// აბრუნებს 'home' / 'away' / null (თუ ვერ ვადგენთ)
function sideOf(ev) {
    if (Number.isInteger(ev.team?.id) && Number.isInteger(match.home_team_id) && Number.isInteger(match.away_team_id)) {
        if (ev.team.id === match.home_team_id) return 'home';
        if (ev.team.id === match.away_team_id) return 'away';
        return null;
    }
    const t = norm(ev.team?.name);
    if (!t) return null;
    if (t === homeName) return 'home';
    if (t === awayName) return 'away';
    return null;
}

// ---------------------------------------------------------------------
//  აიქონები
// ---------------------------------------------------------------------

// დარტყმული პენალტი: თეთრი კარი + ბურთი
// Collapse exact repeated provider records before own-goal score reconciliation.
// Goals are only collapsed when the complete deduplicated goal distribution agrees
// with the official score: two legitimate goals in one minute must not vanish.
const recordKey = ev => JSON.stringify([ev.id ?? null, ev.team?.id ?? norm(ev.team?.name), playerKey(ev),
    ev.assist?.id ?? ev.assist?.name ?? null, norm(ev.type), norm(ev.detail),
    elapsedOf(ev), extraOf(ev), ev.comments ?? null]);
const unique = [], seen = new Set();
for (const ev of events) {
    const key = recordKey(ev);
    if (playerKey(ev) === 'name:' || !seen.has(key)) unique.push(ev);
    seen.add(key);
}
const scoreKnown = [match.home_score, match.away_score].every(n => Number.isInteger(n) && n >= 0);
const goalCount = list => list.filter(isCountedGoal).length;
function goalsFitScore(list) {
    const normal = { home: 0, away: 0 }, own = { home: 0, away: 0 };
    for (const ev of list.filter(isCountedGoal)) {
        const side = sideOf(ev);
        if (!side || elapsedOf(ev) === null) return false;
        (isOwnGoal(ev) ? own : normal)[side]++;
    }
    return (normal.home + own.home === match.home_score && normal.away + own.away === match.away_score)
        || (normal.home + own.away === match.home_score && normal.away + own.home === match.away_score);
}
const goalDuplicatesConfirmed = scoreKnown && goalCount(events) > goalCount(unique) && goalsFitScore(unique);
const accepted = new Set();
events = events.filter(ev => {
    if (playerKey(ev) === 'name:' || (isCountedGoal(ev) && !goalDuplicatesConfirmed)) return true;
    const key = recordKey(ev);
    if (accepted.has(key)) return false;
    accepted.add(key);
    return true;
});

const ICON_PENALTY_SCORED = `<span class="pk-wrap"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 4H20M4 4V15M20 4V15" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="17.5" r="3.4" fill="#ffffff"/><path d="M12 15.3 L13.5 16.4 L13 18.1 L11 18.1 L10.5 16.4 Z" fill="#1a1a1a"/></svg></span>`;

// აცდენილი პენალტი: წითელი კარი + წითელი X
const ICON_PENALTY_MISSED = `<span class="pk-wrap"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 4H20M4 4V15M20 4V15" stroke="#e50914" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 16L15 21M15 16L9 21" stroke="#e50914" stroke-width="2.6" stroke-linecap="round"/></svg></span>`;

// ავტოგოლი: მოწითალო-ვარდისფერი ისარი მარცხნივ + ბურთი
const ICON_OWN_GOAL = `<span class="pk-wrap"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M12 6.5H22" stroke="${OG_COLOR}" stroke-width="2.4" stroke-linecap="round"/><path d="M7 6.5L11.5 3M7 6.5L11.5 10" stroke="${OG_COLOR}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 6.5V10" stroke="${OG_COLOR}" stroke-width="2.4" stroke-linecap="round"/><circle cx="17" cy="19" r="6.2" stroke="${OG_COLOR}" stroke-width="2"/><path d="M17 15.9 L19.2 17.5 L18.4 20.1 L15.6 20.1 L14.8 17.5 Z" fill="${OG_COLOR}"/><path d="M17 15.9V13.4M19.2 17.5L21.4 16.6M18.4 20.1L20 22.2M15.6 20.1L14 22.2M14.8 17.5L12.6 16.6" stroke="${OG_COLOR}" stroke-width="1.3" stroke-linecap="round"/></svg></span>`;

const ICON_BY_CATEGORY = {
    'goal-normal': '',
    'goal-penalty': ICON_PENALTY_SCORED,
    'goal-missed': ICON_PENALTY_MISSED,
    'goal-own': ICON_OWN_GOAL,
    'card-red': `<span class="card-icon red"></span>`,
    'card-second-yellow': `<span class="card-icon second-yellow"></span>`,
};

// რამდენად მნიშვნელოვანია კატეგორია (ადგილი რომ არ ჰყოფნის, დაბალი ქულიანი იკარგება)
const PRIORITY = {
    'goal-normal': 3,
    'goal-penalty': 3,
    'goal-own': 3,
    'card-red': 2,
    'card-second-yellow': 2,
    'goal-missed': 1,
};

// ეს კატეგორიები ერთი მოთამაშისთვის ერთ ხაზად ერთიანდება.
// ბარათები არ ერთიანდება.
const GROUPABLE = new Set(['goal-normal', 'goal-penalty', 'goal-own', 'goal-missed']);

// ---------------------------------------------------------------------
//  ავტოგოლის გუნდის დადგენა საბოლოო ანგარიშით
//  API-ს ზოგჯერ ავტოგოლი იმ გუნდზე უწერია, ვინც გაიტანა, ზოგჯერ იმაზე,
//  ვისაც ჩაეწერა. ვამოწმებთ, რომელი ვარიანტი ემთხვევა საბოლოო ანგარიშს.
// ---------------------------------------------------------------------

let normalHome = 0, normalAway = 0, ogByHomeTeam = 0, ogByAwayTeam = 0;
for (const ev of events) {
    if (!isCountedGoal(ev)) continue;
    const side = sideOf(ev);
    if (!side) continue;
    if (isOwnGoal(ev)) {
        if (side === 'home') ogByHomeTeam++; else ogByAwayTeam++;
    } else {
        if (side === 'home') normalHome++; else normalAway++;
    }
}

const finalHome = Number(match.home_score);
const finalAway = Number(match.away_score);

// ვარიანტი A: event.team = გუნდი, ვისაც გოლი ჩაეწერა
const fitsBeneficiary = (normalHome + ogByHomeTeam === finalHome) && (normalAway + ogByAwayTeam === finalAway);
// ვარიანტი B: event.team = გუნდი, რომლის მოთამაშემაც ავტოგოლი გაიტანა
const fitsScorerTeam = (normalHome + ogByAwayTeam === finalHome) && (normalAway + ogByHomeTeam === finalAway);

let flipOwnGoals;
if (fitsScorerTeam && !fitsBeneficiary) flipOwnGoals = true;
else if (fitsBeneficiary && !fitsScorerTeam) flipOwnGoals = false;
else flipOwnGoals = DEFAULT_OWN_GOAL_TEAM_IS_SCORER_TEAM;

// ---------------------------------------------------------------------
//  საჭირო event-ების არჩევა და დალაგება
// ---------------------------------------------------------------------

const relevant = [];
const seenDismissals = new Set();
for (const ev of events) {
    const category = categoryFor(ev);
    if (!category) continue;

    // დრო ან გუნდი რომ არ აქვს, გამოვტოვებთ და მთელ სურათს არ ვანგრევთ
    if (elapsedOf(ev) === null) {
        console.log('skip event without time:', JSON.stringify(ev));
        continue;
    }
    let side = sideOf(ev);
    if (!side) {
        console.log('skip event with unknown team:', JSON.stringify(ev));
        continue;
    }

    // ავტოგოლი გამოჩნდება იმ გუნდის გრაფაში, ვისაც გოლი ჩაეწერა
    if (category === 'goal-own' && flipOwnGoals) side = side === 'home' ? 'away' : 'home';

    if (category.startsWith('card-') && playerKey(ev) !== 'name:') {
        const key = `${side}|${playerKey(ev)}|${elapsedOf(ev)}|${extraOf(ev)}`;
        if (seenDismissals.has(key)) continue;
        seenDismissals.add(key);
    }
    relevant.push({ ev, category, side });
}

// Array.sort სტაბილურია, ამიტომ ერთსა და იმავე წუთზე თავდაპირველი რიგი რჩება
relevant.sort((a, b) => sortValue(a.ev) - sortValue(b.ev));

// ---------------------------------------------------------------------
//  დაჯგუფება
//  - გოლები / პენალტები / ავტოგოლები: იგივე მოთამაშე + იგივე კატეგორია -> ერთი ხაზი
//  - გასაღები არის player.id (არა შემოკლებული სახელი), რომ ორი "J. Silva" არ შეერთდეს
//  - ბარათები არასოდეს ერთიანდება
// ---------------------------------------------------------------------

const groups = [];
const groupIndex = new Map();

relevant.forEach(({ ev, category, side }, i) => {
    const name = esc(abbreviate(ev.player?.name));
    const minute = minuteLabel(ev);

    // უცნობი მოთამაშეები (id და სახელი არ აქვთ) არასოდეს ერთიანდებიან
    const knownPlayer = playerKey(ev) !== 'name:';
    const key = GROUPABLE.has(category) && knownPlayer
        ? `${side}|${playerKey(ev)}|${category}`
        : `${side}|unique-${i}`;

    if (groupIndex.has(key)) {
        groups[groupIndex.get(key)].minutes.push(minute);
    } else {
        groupIndex.set(key, groups.length);
        groups.push({ side, name, category, minutes: [minute] });
    }
});

// ---------------------------------------------------------------------
//  ადგილის ლიმიტი: თითო მხარეს MAX_ROWS_PER_SIDE ხაზი
//  ჯერ იგდება ყველაზე ნაკლებად მნიშვნელოვანი (უახლესიდან დაწყებული)
// ---------------------------------------------------------------------

function limitRows(list) {
    const kept = [...list];
    while (kept.length > MAX_ROWS_PER_SIDE) {
        const lowest = Math.min(...kept.map(g => PRIORITY[g.category]));
        if (lowest >= 3) break; // გოლებს არასოდეს ვაგდებთ

        let dropAt = -1;
        for (let i = kept.length - 1; i >= 0; i--) {
            if (PRIORITY[kept[i].category] === lowest) { dropAt = i; break; }
        }
        kept.splice(dropAt, 1);
    }
    return kept;
}

const homeGroups = limitRows(groups.filter(g => g.side === 'home'));
const awayGroups = limitRows(groups.filter(g => g.side === 'away'));

// ---------------------------------------------------------------------
//  HTML
// ---------------------------------------------------------------------

function rowHtml(g) {
    const icon = ICON_BY_CATEGORY[g.category] ?? '';
    const minuteHtml = `<span class="minute">${g.minutes.join(', ')}'</span>`;
    const nameHtml = g.name ? `<span class="player-name">${g.name}</span>` : '';
    const sep = g.name ? `<span class="sep">|</span>` : '';

    return g.side === 'home'
        ? `<div class="event">${icon}${minuteHtml}${sep}${nameHtml}</div>`
        : `<div class="event">${nameHtml}${sep}${minuteHtml}${icon}</div>`;
}

return {
    home_events_html: homeGroups.map(rowHtml).join(''),
    away_events_html: awayGroups.map(rowHtml).join(''),
    total_events: homeGroups.length + awayGroups.length
};
}
