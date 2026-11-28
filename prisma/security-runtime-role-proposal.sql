-- PROPOSAL ONLY. Do not execute until the owner separately approves role/grant changes.
-- Run as the existing migration owner in the VERIFIED Final Whistle database.
-- Set the runtime password through a secure interactive credential flow, never this file.
BEGIN;
CREATE ROLE final_whistle_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT CONNECT ON DATABASE neondb TO final_whistle_runtime;
GRANT USAGE ON SCHEMA public TO final_whistle_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
 public."User", public."AuthIdentity", public."Session", public."Brand",
 public."Subscription", public."FavoriteTeam", public."Template", public."NewsTemplate",
 public."NewsSettings", public."Match", public."Selection", public."Team",
 public."FixtureDay", public."ApiUsage", public."MatchPairingChallenge",
 public."MatchTelegramBinding", public."TelegramMember",
 public."MatchDeliveryReceipt"
 TO final_whistle_runtime;
-- PUBLIC USAGE/CONNECT/TEMPORARY are compatible; PUBLIC CREATE would defeat isolation.
-- Abort rather than changing grants for other existing accounts without approval.
DO $$
BEGIN
 IF has_schema_privilege('final_whistle_runtime','public','CREATE')
    OR has_database_privilege('final_whistle_runtime',current_database(),'CREATE')
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='final_whistle_runtime'))
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=(SELECT oid FROM pg_roles WHERE rolname='final_whistle_runtime'))
 THEN RAISE EXCEPTION 'Runtime privilege isolation failed; review PUBLIC grants, membership and ownership'; END IF;
END $$;
-- Existing neondb_owner stays the separate migration/DDL identity; runtime owns nothing.
-- No default grants or schema creation privileges. Review grants for each future migration.
-- Before activation: securely set password/LOGIN, test queries/locks in an isolated DB,
-- then change DATABASE_URL only with approval. Keep migration URL separate.
COMMIT;
