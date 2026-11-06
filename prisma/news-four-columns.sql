-- PREPARED ONLY: NOT EXECUTED. Awaiting explicit final production approval.
-- Target: ancient-water-31700615 / production (br-polished-frog-b1q4lv07) / neondb.
-- The user explicitly chose to proceed without verified backup or test branches.
-- No branch creation, credential change or MCP configuration change is authorized here.
-- This file creates no backup and does not execute automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;

DO $news_migration$
DECLARE
  target_oid oid;
  before_count bigint;
  after_count bigint;
  before_digest text;
  after_digest text;
BEGIN
  IF current_database() IS DISTINCT FROM 'neondb'
     OR current_setting('neon.project_id', true) IS DISTINCT FROM 'ancient-water-31700615'
     OR current_setting('neon.branch_id', true) IS DISTINCT FROM 'br-polished-frog-b1q4lv07'
  THEN
    RAISE EXCEPTION 'Wrong project, branch or database; no migration performed';
  END IF;

  target_oid := to_regclass('"public"."NewsSettings"');
  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'Expected public.NewsSettings table is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger WHERE evtenabled <> 'D') THEN
    RAISE EXCEPTION 'Enabled DDL event triggers require separate review';
  END IF;

  -- Bound the wait and keep existing rows stable throughout verification/DDL.
  LOCK TABLE "public"."NewsSettings" IN ACCESS EXCLUSIVE MODE;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = target_oid AND relkind = 'r'
      AND NOT relrowsecurity AND NOT relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Unexpected NewsSettings table kind or row security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits
             WHERE inhparent=target_oid OR inhrelid=target_oid) THEN
    RAISE EXCEPTION 'Unexpected table inheritance requires separate review';
  END IF;

  -- Require the exact reviewed six-column baseline. A partial/previous upgrade
  -- or unrelated schema change stops execution instead of silently proceeding.
  IF (SELECT count(*) FROM pg_catalog.pg_attribute
      WHERE attrelid=target_oid AND attnum>0 AND NOT attisdropped) <> 6
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('userId', false), ('botToken', true), ('botId', true),
         ('botUsername', true), ('telegramChatId', true), ('defaultTemplateRef', false)
       ) AS expected(name, nullable)
       LEFT JOIN pg_catalog.pg_attribute a
         ON a.attrelid=target_oid AND a.attname=expected.name
           AND a.attnum>0 AND NOT a.attisdropped
       WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>'text'
         OR (NOT a.attnotnull)<>expected.nullable
         OR a.attidentity<>'' OR a.attgenerated<>''
         OR a.atthasdef<>(expected.name='defaultTemplateRef')
     ) THEN
    RAISE EXCEPTION 'NewsSettings baseline changed; stop and audit again';
  END IF;
  IF (SELECT pg_get_expr(d.adbin,d.adrelid)
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=target_oid AND a.attname='defaultTemplateRef')
      IS DISTINCT FROM $default_value$'single'::text$default_value$ THEN
    RAISE EXCEPTION 'Unexpected existing template default';
  END IF;

  -- Digests stay inside the server and are never printed. Compare only the six
  -- original fields, so new NULL fields do not change the preservation check.
  SELECT count(*), md5(coalesce(string_agg(
    md5(ROW("userId","botToken","botId","botUsername","telegramChatId","defaultTemplateRef")::text),
    '' ORDER BY "userId"),''))
  INTO before_count, before_digest FROM "public"."NewsSettings";

  -- The only persistent schema changes in this prepared transaction.
  ALTER TABLE "public"."NewsSettings"
    ADD COLUMN IF NOT EXISTS "linkCodeHash" TEXT,
    ADD COLUMN IF NOT EXISTS "linkExpiresAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "pending" JSONB,
    ADD COLUMN IF NOT EXISTS "lastUpdateId" INTEGER;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('linkCodeHash','text'),
      ('linkExpiresAt','timestamp(3) without time zone'),
      ('pending','jsonb'),
      ('lastUpdateId','integer')
    ) AS expected(name, type_name)
    LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid=target_oid AND a.attname=expected.name
        AND a.attnum>0 AND NOT a.attisdropped
    WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.type_name
      OR a.attnotnull OR a.atthasdef OR a.attidentity<>'' OR a.attgenerated<>''
  ) OR (SELECT count(*) FROM pg_catalog.pg_attribute
        WHERE attrelid=target_oid AND attnum>0 AND NOT attisdropped)<>10 THEN
    RAISE EXCEPTION 'Post-migration column validation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."NewsSettings"
      WHERE "linkCodeHash" IS NOT NULL OR "linkExpiresAt" IS NOT NULL
         OR "pending" IS NOT NULL OR "lastUpdateId" IS NOT NULL) THEN
    RAISE EXCEPTION 'New columns contain unexpected values';
  END IF;

  SELECT count(*), md5(coalesce(string_agg(
    md5(ROW("userId","botToken","botId","botUsername","telegramChatId","defaultTemplateRef")::text),
    '' ORDER BY "userId"),''))
  INTO after_count, after_digest FROM "public"."NewsSettings";
  IF before_count IS DISTINCT FROM after_count OR before_digest IS DISTINCT FROM after_digest THEN
    RAISE EXCEPTION 'Existing NewsSettings rows changed; aborting transaction';
  END IF;
END;
$news_migration$;

-- Any exception aborts the transaction. The executor must stop and ROLLBACK;
-- never continue/retry automatically after a timeout, drift or assertion error.
COMMIT;
