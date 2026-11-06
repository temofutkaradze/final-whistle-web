# H1 authentication hardening: prepared, not activated

Date: 2026-11-06. Main project only. This is a source-code preparation and offline schema review. No production database was queried or changed; no accounts/passwords/sessions, environment settings or live services were changed. Stage 1 has not been activated. The historical [production audit](./PRODUCTION_AUDIT.md) describes the original H1 finding.

## Implemented policy

Previously, signup accepted an unverified email, and the Google callback reused an account by email without proving ownership of its password account. The creation-error fallback repeated the same unsafe association. Google subjects were discarded.

Google's server-authenticated UserInfo response must now supply a nonempty, bounded subject and verified email. Subjects are opaque and are not trimmed, case-folded or inferred from email. Existing state/PKCE, fixed Google endpoints and session cookie protections are retained.

The callback authenticates exclusively through `(provider = google, subject)`. A stored binding wins regardless of a changed Google email; it never moves to an email-matched account or updates that account's email/password. A missing binding plus any existing email (password-enabled, passwordless legacy or another Google subject) fails closed. No automatic legacy backfill, account merge, self-service linking or password recovery endpoint was introduced. Signed-in sessions and caller-supplied user/link query parameters confer no linking authority.

For a new, noncolliding profile, the user, default brand and identity are created in one Prisma transaction. Both uniqueness constraints are database-enforced. On P2002, the transaction has rolled back; the only permitted race recovery is a committed binding for that same subject. Different-subject email races and password-signup races never share accounts. Other database failures fail closed, including a missing identity table. The callback creates an ordinary session only after successful identity resolution; a session-storage failure does not redirect to the dashboard. A successfully committed account remains usable on a subsequent Google attempt if session creation failed.

Password login, password hashing, local signup behavior and existing session records are unchanged. Login/signup copy now explains the closed collision path instead of directing passwordless legacy accounts to an unsafe email-only Google login. Local signup email remains unverified; it is never proof for Google linking. Email reservation/squatting remains a possible denial-of-registration issue.

## Database migration requirements — separate approval required

[Prisma schema](../prisma/schema.prisma) adds AuthIdentity and an inverse User relation. [Prepared SQL](../prisma/auth-identity.sql) was generated using local before/after schemas, then schema-qualified, wrapped transactionally with lock/statement timeouts, and supplemented with Google-provider and nonempty-subject CHECK constraints.

The SQL creates only AuthIdentity, its two unique indexes and its constraints. It performs no user/session/password/data backfill or DML. Its FK references public.User; ON DELETE/UPDATE CASCADE describes future explicit parent operations and does not change existing rows during migration. Prisma supplies cuid IDs when creating identities; the SQL intentionally has no database ID generator.

Before any execution, independently verify the real deployment schema is public, User.id is the expected referenced primary key/type, the identity table does not already exist, and there are no unexpected schema differences. This preparation did not inspect production. Require a verified recoverable backup, reviewed SQL checksum, appropriate CREATE/REFERENCES permissions and an approved release window. Stop on conflicts; there is no IF NOT EXISTS or retry that silently accepts a different table.

This repository currently uses standalone migration SQL rather than an established Prisma migration history. Do not run migrate dev, db push, reset, or assume migrate deploy will apply this file. Decide and review the migration application/history procedure separately; do not baseline or reconcile unrelated tables here. No migration runner, startup migration or database-changing command was added.

## Supervised legacy recovery — not implemented or authorized here

Records with a password hash are password-enabled; they are not proof of email ownership or evidence that previous Google logins were legitimate. Passwordless records cannot distinguish old Google registrations from test accounts. Existing sessions record no authentication method/provenance and must not bootstrap identity ownership. Do not infer a binding from NULL passwordHash, matching verified email, current session or mutable profile data.

Before cutover, prepare independent ownership review for Google users without stored subjects. Obtain fresh server-verified Google authentication, explicit user consent and operator approval tied to the exact user ID and subject. A user-provided subject string is not authentication evidence. If ownership remains ambiguous, preserve the account/data but deny automatic Google access; temporary access interruption may be unavoidable.

An approved recovery operation must enforce both identity uniqueness constraints, resolve potentially attacker-controlled passwords explicitly, and revoke all old sessions for that account before issuing fresh access. Revocation alone is insufficient while an attacker's password still works. Do not silently clear or retain disputed credentials as an ownership decision. Preserve an appropriately protected audit trail of authorization and outcome without tokens/passwords.

This release contains no recovery writer or synchronization protocol for concurrent recovery and session issuance. Perform no ad hoc live recovery updates while authentication requests are in flight. A later approved recovery procedure must either drain authentication traffic during the operation or implement consistent account locking/version checks across all authentication/session issuers. Requests that authenticated before revocation must not reissue sessions afterward using stale credentials. Existing in-flight authenticated actions are not retroactively undone by deleting sessions.

## Rollout gate

1. Independently review this code and migration. Approve legacy recovery, session/credential decisions and acceptable temporary legacy access restrictions. No claim of complete historical compromise remediation is made.
2. Prepare a recoverable backup and a whole-release rollback artifact containing matching application/build/Prisma Client files. Prepare a security-safe rollback before cutover.
3. Apply only the separately approved additive SQL after production schema verification. Verify empty identity table, exact types/constraints, and unchanged existing records. Do not backfill by email.
4. Generate the matching Prisma Client and run the reviewed deployment/build checks in the deployment environment. This turn generated the local client with a dummy offline datasource and did not run a production build.
5. Coordinate the authentication cutover so old email-linking callbacks cannot remain active beside the new code. Do not restart services or change live routing without separate approval. Drain/restart OAuth attempts as needed and verify password login, new Google signup, bound-subject login and closed collision/recovery messaging manually.
6. Complete approved recovery and session-revocation work before claiming previously compromised accounts are secure. Existing vulnerable live behavior remains until an approved deployment; changing source files alone is not activation.

## Safe rollback

Retain AuthIdentity and its bindings. Do not drop the table, delete accounts, undo approved credential recovery or restore revoked sessions. The additive schema can remain during application rollback.

Do not restore the old Google callback as an active fallback: it ignores bindings and recreates H1. Roll back only to an independently verified fail-closed authentication release, or block Google entry/callback routes during a controlled rollback until the hardened release is restored. That fallback/routing action requires separate approval; none was performed here. Restore a complete matching release/build/client, never mixed Next.js output or mismatched generated clients. Existing password access may continue under the approved fallback policy, but it is not proof that disputed accounts are safe.

## Files changed in this preparation

- [prisma/schema.prisma](../prisma/schema.prisma): additive identity model, uniqueness constraints and inverse relation; clarify passwordless-account comment.
- [prisma/auth-identity.sql](../prisma/auth-identity.sql): standalone, unexecuted additive transaction.
- [src/lib/google.ts](../src/lib/google.ts): retain and validate provider subject in verified profiles.
- [src/lib/google-auth.ts](../src/lib/google-auth.ts): transactional subject resolution/creation and bounded uniqueness-race handling.
- [Google callback](../src/app/auth/google/callback/route.ts): remove email-based authentication/fallback and issue sessions only for resolved subjects.
- [Login](../src/app/login/page.tsx) and [signup](../src/app/signup/page.tsx): collision/recovery messaging only; password logic unchanged.
- [Google helper tests](../tests/google.test.ts), [identity-resolution tests](../tests/google-auth.test.ts), [callback tests](../tests/google-callback.test.ts), [migration-safety tests](../tests/auth-identity-migration.test.ts), [password-login tests](../tests/password-login.test.ts).
- This document. No R2/H2, renderer, bot, dependency or Owner-Only Mode changes.

Ignored local storage holds the pre-change schema, generated SQL and offline Prisma config (no dotenv/production URL). The generated local Prisma Client is an ignored build dependency, not a migration or runtime activation.

## Verification

- Local schema-to-schema Prisma diff reviewed: only the new table/indexes/FK. No database datasource diff or connection used. Prisma schema validation and local client generation passed.
- 50 focused tests passed across six files: google, google-auth, google-callback, password, auth-identity-migration and password-login. Database calls and Google exchange are mocked; concurrency tests use a transactional in-memory fake with commit-time uniqueness checks, not real PostgreSQL. A local SQL assertion initially confused FK ON DELETE/UPDATE clauses with DML and prevented file creation; after correction, the affected migration suite passed (2 tests), while the earlier four successful suites (46 tests) were preserved. Password-action integration added 2 successful tests using real scrypt verification against mocked accounts.
- Application/test TypeScript checks passed; the test check is repeated after adding the last password-action test. No full suite or production build. No real Google consent, PostgreSQL race execution, production schema validation, recovery, migration or deployment was tested.

**Stop:** prepared for independent review only. H1 is not live-remediated; activation and any production migration/recovery require separate approval.

Final verification: schema comparison confirmed no changes to existing models beyond the inverse identity relation/comment; tracked-file whitespace check passed. Prepared SQL SHA-256: `4FDD3E834334A174D0231C054848E34F6A1D648D3038D99714DA358B177548B4`. Final test TypeScript check passed after the last regression was added.
