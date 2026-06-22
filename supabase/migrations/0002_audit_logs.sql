-- ============================================================================
-- 0002_audit_logs.sql
--
-- Tamper-evident audit trail. Every mutating statement on a tracked table is
-- captured into a dedicated `<table>_audit_log` table by a single generic
-- trigger function, recording:
--     * operation (INSERT | UPDATE | DELETE)
--     * full OLD and NEW row images (jsonb)
--     * the acting user id (app.current_actor())
--     * a precise statement timestamp + txid for correlation
--
-- The audit tables live in a separate `audit` schema and are append-only:
-- RLS (migration 0004) forbids UPDATE/DELETE for everyone but service_role.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------------------
-- Shared columns for every audit table, created via a template helper.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.products_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation   text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id      uuid,
  old_data    jsonb,
  new_data    jsonb,
  actor_id    uuid,
  txid        bigint NOT NULL DEFAULT txid_current(),
  logged_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS audit.inventory_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation   text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id      uuid,
  old_data    jsonb,
  new_data    jsonb,
  actor_id    uuid,
  txid        bigint NOT NULL DEFAULT txid_current(),
  logged_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS audit.orders_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation   text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),
  row_id      uuid,
  old_data    jsonb,
  new_data    jsonb,
  actor_id    uuid,
  txid        bigint NOT NULL DEFAULT txid_current(),
  logged_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_products_audit_row   ON audit.products_audit_log (row_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_row  ON audit.inventory_audit_log (row_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_audit_row     ON audit.orders_audit_log (row_id, logged_at DESC);

-- ---------------------------------------------------------------------------
-- Generic audit trigger function.
--
-- The target audit table is passed as TG_ARGV[0]. The primary key column is
-- assumed to be `id` (uuid) for products/orders, and `product_id` for
-- inventory; we resolve it dynamically from the row jsonb.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.if_modified() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, public, pg_temp AS $$
DECLARE
  v_audit_table text := TG_ARGV[0];
  v_pk_col      text := COALESCE(TG_ARGV[1], 'id');
  v_old         jsonb;
  v_new         jsonb;
  v_row_id      uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
    v_row_id := (v_old ->> v_pk_col)::uuid;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row_id := (v_new ->> v_pk_col)::uuid;
  ELSE -- INSERT
    v_old := NULL;
    v_new := to_jsonb(NEW);
    v_row_id := (v_new ->> v_pk_col)::uuid;
  END IF;

  EXECUTE format(
    'INSERT INTO %I (operation, row_id, old_data, new_data, actor_id) VALUES ($1,$2,$3,$4,$5)',
    v_audit_table
  )
  USING TG_OP, v_row_id, v_old, v_new, app.current_actor();

  -- For an AFTER trigger the return value is ignored, but be correct anyway.
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Wire the trigger onto each tracked table.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_products ON public.products;
CREATE TRIGGER trg_audit_products
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION audit.if_modified('products_audit_log', 'id');

DROP TRIGGER IF EXISTS trg_audit_inventory ON public.inventory;
CREATE TRIGGER trg_audit_inventory
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION audit.if_modified('inventory_audit_log', 'product_id');

DROP TRIGGER IF EXISTS trg_audit_orders ON public.orders;
CREATE TRIGGER trg_audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION audit.if_modified('orders_audit_log', 'id');
