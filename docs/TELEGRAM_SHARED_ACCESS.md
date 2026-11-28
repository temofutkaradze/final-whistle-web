# Shared access to existing Telegram bots

## Ownership and onboarding

Each existing website bot owner can manage users for **their own existing bots**
under Dashboard → User Management. This is tenant-scoped ownership, not a global
administrator role. A website account without a connected bot cannot administer
access; submitted owner/account IDs are never accepted as authority.

Ask the other person to send `/start` in a private chat with the existing bot.
It displays their authenticated numeric Telegram User ID and approval instructions.
Enter that ID in User Management, optionally add a display name, select Match
and/or News permission, and save with Active status. Approval is read on subsequent
updates without restarting the managers. Existing owner pairing/linking remains
unchanged and takes precedence. Group, channel, bot and mismatched sender/chat
identities do not grant access. Usernames are not authorization evidence.

Suspended or Revoked status denies both generators. Individual permission boxes
can disable either generator independently. Restore access by selecting Active
and the desired permissions. Owner-bound Telegram IDs are protected from these
operations. Revocation is retained as a record rather than deleting history.

## Isolation and execution

- `TelegramMember` maps an owner's approved Telegram identity to a new isolated
  `User` principal. Existing user ownership keys are reused for selections,
  subscriptions, favorite teams, brands, templates, uploaded background paths,
  and `NewsSettings` conversation state. No owner selections or private templates
  are copied. A default brand and default News settings are created for the person.
- Principals have random `@telegram.invalid` addresses, no password or OAuth
  identity, and no stored bot tokens. They cannot use website login sessions.
  These internal addresses are not contact addresses. Owners manage permissions;
  this feature does not create separate website accounts for Telegram guests.
- Match resolves the current actor before commands/callbacks/uploads. Existing
  match helpers receive that person's scoped database context. Delegated writes
  serialize with permission management on the existing owner-account row lock.
  Direct delegated model writes enforce principal ownership and protect account
  credentials/administration models.
- News retains one poller and one global Telegram update cursor per existing bot.
  Each principal has its own durable update claim, pending state and settings.
  The adapter supplies the owner's connection only in memory; credentials are
  never copied into the principal's `NewsSettings` record.
- Renderer processes, queues, locks, manager discovery and launchers are reused.
  No bot, polling loop, worker, browser or renderer is created per person. Existing
  per-bot polling still processes updates sequentially; concurrent adapter tests
  establish isolation, not parallel Telegram polling within a single bot.
- Delegated admission allows 20 updates/minute/person, one active operation per
  person and at most two admitted operations per manager/router. The budget is
  bounded to 512 keys; administration allows at most 100 members per owner.
  Owner operations retain their existing limits. Renderer limits remain unchanged.

Automatic Match candidates include delegated principals without bot tokens, then
use the existing authorization gate before any provider work. Match data/event
caches remain shared; personal selections, backgrounds, image IDs, and recipients
remain separate. Both 90+ and final documents use the principal's private chat
through the same existing bot. PNG-only wrappers and every renderer/template
remain unchanged.

## Revocation

Every delegated protected write, download, and Telegram send checks current
membership and the expected permission version. Match automatic/manual delivery
also rechecks its current actor and connection. Changing permissions increments
the version so revoke-and-restore cannot revive an already-running operation.
Disabling access clears pending News conversations and retires selected/sending
Match jobs for that person; restoration does not replay them. Existing delivery
fences and historical receipts are retained. No files or historical rows are
automatically deleted by this feature.

As with any external delivery API, an already-dispatched Telegram request cannot
be recalled if access is revoked while Telegram is accepting it. Checks occur
before dispatch; no automatic resend bypasses revocation. External network calls
are deliberately not performed while holding a database transaction open.

## Files and activation

- [Permission schema](../prisma/schema.prisma) and
  [additive SQL](../prisma/telegram-members.sql).
- [Authorization](../scripts/lib/member-access.mjs),
  [scoped writes/delivery](../scripts/lib/member-data.mjs),
  [management](../scripts/lib/member-management.mjs),
  [News routing](../scripts/lib/news-member-router.mjs).
- [Website management](../src/app/dashboard/users/page.tsx) and
  [authenticated server action](../src/app/dashboard/users/actions.ts).

**The SQL has not been applied. Production activation requires separate approval.**
The SQL creates only `public.TelegramMember` and its constraints; it does not alter
existing user data. Review it against the target database, back up and use an
approved migration connection with stop-on-error behavior. Do not use `db push`,
generic installers, or destructive schema synchronization. Prisma client generation
is local-only and has been performed; regenerate it on any other checkout after
the approved schema update. Build the website after source/schema integration.
Start the existing launcher manually only after approval and readiness checks.

Before the table exists, owner bot workflows remain supported and new member
lookups fail closed. User Management shows an activation-required notice instead
of offering ineffective controls. No automatic schema mutation occurs at startup.

Verification uses mocked Telegram/provider/persistence inputs, including owner
regressions, two independent News workflows, private recipient routing, live/final
Match delivery, version revocation, forged identities, owner protection and
unauthorized website actions. The additive SQL is schema-validated but has not
been exercised against a live PostgreSQL database; transactional behavior and
multi-process revocation require a separately approved database staging check.
