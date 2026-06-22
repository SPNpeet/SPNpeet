-- ============================================================================
-- 0001_core_schema.sql
--
-- Core domain model for the POS & Inventory engine.
--
--   products              — catalog (sku, barcode, price)
--   inventory             — current on-hand quantity per product (1:1)
--   orders                — a completed sale (header)
--   order_items           — line items of an order
--   inventory_transactions— immutable ledger of every stock movement
--
-- Money is stored as `numeric(12,2)` (never floats). Quantities are integers.
-- All timestamps are `timestamptz` in UTC.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('pending', 'completed', 'voided', 'refunded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_txn_type') THEN
    CREATE TYPE inventory_txn_type AS ENUM (
      'sale',        -- deduction from a checkout
      'restock',     -- positive adjustment / purchase order receipt
      'adjustment',  -- manual correction (can be +/-)
      'void',        -- reversal of a sale
      'refund'       -- customer return
    );
  END IF;
END
$$;

-- Reusable trigger to keep `updated_at` fresh on every row update.
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         citext NOT NULL UNIQUE,
  barcode     citext UNIQUE,                       -- EAN/UPC; nullable for non-scanned items
  name        text   NOT NULL,
  description text,
  -- Price the customer pays, tax-inclusive depending on jurisdiction config.
  price       numeric(12,2) NOT NULL CHECK (price >= 0),
  -- Cost basis for margin reporting (optional).
  cost        numeric(12,2) CHECK (cost >= 0),
  tax_rate    numeric(5,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate < 1),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_active  ON public.products (is_active) WHERE is_active;

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory (current on-hand, 1:1 with products). This is the row the Golang
-- engine pessimistically locks (SELECT ... FOR UPDATE) during checkout.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
  product_id    uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  -- on_hand must never go negative; enforced by CHECK + engine validation.
  quantity      integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  -- Reorder threshold for low-stock alerting.
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_inventory_updated_at ON public.inventory;
CREATE TRIGGER trg_inventory_updated_at
  BEFORE UPDATE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Auto-create an inventory row whenever a product is created.
CREATE OR REPLACE FUNCTION app.ensure_inventory_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.inventory (product_id, quantity)
  VALUES (NEW.id, 0)
  ON CONFLICT (product_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_ensure_inventory ON public.products;
CREATE TRIGGER trg_products_ensure_inventory
  AFTER INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION app.ensure_inventory_row();

-- ---------------------------------------------------------------------------
-- orders (sale header)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-friendly receipt number, monotonically increasing.
  order_number  bigint GENERATED ALWAYS AS IDENTITY,
  -- Idempotency key supplied by the offline client (UUID generated on device).
  -- Guarantees a queued offline sale syncs exactly once even on retry.
  client_uuid   uuid NOT NULL UNIQUE,
  status        order_status NOT NULL DEFAULT 'completed',
  subtotal      numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  tax_total     numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total         numeric(12,2) NOT NULL CHECK (total >= 0),
  -- The staff member (Supabase auth user) who rang the sale.
  cashier_id    uuid,
  -- When the sale actually happened on the device (may differ from synced_at
  -- for offline orders).
  sold_at       timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_cashier ON public.orders (cashier_id);
CREATE INDEX IF NOT EXISTS idx_orders_sold_at ON public.orders (sold_at DESC);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items (sale lines)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  -- Snapshot of product fields at sale time (price can change later).
  sku          citext NOT NULL,
  name         text   NOT NULL,
  unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate     numeric(5,4)  NOT NULL DEFAULT 0,
  quantity     integer NOT NULL CHECK (quantity > 0),
  line_total   numeric(12,2) NOT NULL CHECK (line_total >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order   ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- inventory_transactions (immutable stock ledger). Every checkout writes a
-- 'sale' row per line; restocks/adjustments write their own. on_hand in the
-- inventory table is always reconstructable from this ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  -- Signed delta: negative for sales, positive for restocks.
  delta         integer NOT NULL CHECK (delta <> 0),
  -- Resulting quantity AFTER applying the delta (for fast point-in-time audit).
  resulting_qty integer NOT NULL CHECK (resulting_qty >= 0),
  txn_type      inventory_txn_type NOT NULL,
  -- Links a 'sale'/'void'/'refund' movement back to its order.
  order_id      uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  actor_id      uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_product ON public.inventory_transactions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_txn_order   ON public.inventory_transactions (order_id);

-- ---------------------------------------------------------------------------
-- Low-stock convenience view.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.low_stock_products AS
  SELECT p.id, p.sku, p.name, i.quantity, i.reorder_level
  FROM public.products p
  JOIN public.inventory i ON i.product_id = p.id
  WHERE p.is_active AND i.quantity <= i.reorder_level;
