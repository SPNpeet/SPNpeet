-- ============================================================================
-- 0000_compat_shim.sql
--
-- PURPOSE
--   Make the entire migration set portable across two environments:
--     1. Supabase Postgres (where the `auth` schema, `auth.uid()`,
--        and the `anon` / `authenticated` / `service_role` roles already exist).
--     2. A vanilla `postgres:16` container (docker-compose local stack), where
--        none of those exist.
--
--   Everything here is created **only if missing**, so running on Supabase is a
--   no-op and running locally provisions a faithful stand-in.
--
--   This file MUST sort first (0000) so later migrations can rely on it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive barcodes/sku

-- ---------------------------------------------------------------------------
-- Roles (Supabase already ships these). Created NOLOGIN to mirror Supabase.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- `auth` schema + minimal `auth.uid()` / `auth.role()` shims.
--
-- On Supabase these functions read the request JWT claims. Locally (and inside
-- the Golang engine, which connects as a single DB role) we instead read a
-- transaction-scoped GUC `app.current_user_id` that the API sets via
-- `SET LOCAL` after verifying the Supabase JWT. We only define the shim if the
-- real Supabase functions are absent.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $body$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$;
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'role'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE AS $body$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
      $body$;
    $fn$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Application schema for our own helper functions.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;

-- Single source of truth for "who is acting".
--   1. `app.current_user_id` GUC, set by the Golang engine (SET LOCAL) after
--      JWT verification — works even though Go uses one pooled DB role.
--   2. Fallback to auth.uid() for direct Supabase / PostgREST access.
CREATE OR REPLACE FUNCTION app.current_actor() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    auth.uid()
  )
$$;

COMMENT ON FUNCTION app.current_actor() IS
  'Resolves the acting user id from the app.current_user_id GUC (set by the Go engine) or the Supabase JWT.';
