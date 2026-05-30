-- ============================================================================
-- 0004_rls_policies.sql
--
-- Strict Row Level Security. Default posture: DENY. Only authenticated staff
-- (Supabase `authenticated` role) may read/write operational data. The Golang
-- engine connects with elevated privileges (DB owner / service_role) and is
-- expected to set app.current_user_id for audit attribution.
--
-- Audit tables are append-only: nobody but service_role can SELECT them from
-- the client (audit data is sensitive); no one may UPDATE/DELETE them at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS + lock down default grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit.products_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.inventory_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.orders_audit_log     ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners reached via PostgREST is not desired; we keep
-- service_role (BYPASSRLS) able to do maintenance. Revoke anon entirely.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA audit FROM anon, authenticated;

-- Base grants for the authenticated role (RLS still filters rows).
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO authenticated;

-- ---------------------------------------------------------------------------
-- Helper: is the current request an authenticated staff member?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.is_staff() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT auth.role() = 'authenticated' OR app.current_actor() IS NOT NULL
$$;

-- ===========================================================================
-- products
-- ===========================================================================
DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated USING (app.is_staff());

DROP POLICY IF EXISTS products_write ON public.products;
CREATE POLICY products_write ON public.products
  FOR ALL TO authenticated
  USING (app.is_staff())
  WITH CHECK (app.is_staff());

-- ===========================================================================
-- inventory
-- ===========================================================================
DROP POLICY IF EXISTS inventory_select ON public.inventory;
CREATE POLICY inventory_select ON public.inventory
  FOR SELECT TO authenticated USING (app.is_staff());

DROP POLICY IF EXISTS inventory_write ON public.inventory;
CREATE POLICY inventory_write ON public.inventory
  FOR ALL TO authenticated
  USING (app.is_staff())
  WITH CHECK (app.is_staff());

-- ===========================================================================
-- orders — staff can read all; can only create rows attributed to themselves.
-- ===========================================================================
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated USING (app.is_staff());

DROP POLICY IF EXISTS orders_insert ON public.orders;
CREATE POLICY orders_insert ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (cashier_id = app.current_actor() OR cashier_id IS NULL);

DROP POLICY IF EXISTS orders_update ON public.orders;
CREATE POLICY orders_update ON public.orders
  FOR UPDATE TO authenticated
  USING (app.is_staff())
  WITH CHECK (app.is_staff());

-- ===========================================================================
-- order_items
-- ===========================================================================
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items
  FOR SELECT TO authenticated USING (app.is_staff());

DROP POLICY IF EXISTS order_items_insert ON public.order_items;
CREATE POLICY order_items_insert ON public.order_items
  FOR INSERT TO authenticated WITH CHECK (app.is_staff());

-- ===========================================================================
-- inventory_transactions — read-only ledger from the client side.
-- ===========================================================================
DROP POLICY IF EXISTS inv_txn_select ON public.inventory_transactions;
CREATE POLICY inv_txn_select ON public.inventory_transactions
  FOR SELECT TO authenticated USING (app.is_staff());

DROP POLICY IF EXISTS inv_txn_insert ON public.inventory_transactions;
CREATE POLICY inv_txn_insert ON public.inventory_transactions
  FOR INSERT TO authenticated WITH CHECK (app.is_staff());

-- ===========================================================================
-- audit.* — append-only, no client SELECT/UPDATE/DELETE. service_role only
-- (which bypasses RLS). With no permissive policies, all access is denied to
-- authenticated/anon, which is exactly what we want for compliance data.
-- ===========================================================================
-- (Intentionally NO policies created -> default deny for non-bypass roles.)

-- ---------------------------------------------------------------------------
-- Default privileges so future objects inherit the locked-down posture.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
