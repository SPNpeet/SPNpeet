-- ============================================================================
-- 0003_checkout_functions.sql
--
-- Atomic, concurrency-safe stock operations implemented in PL/pgSQL.
--
-- The Golang Transaction Engine owns the primary checkout path and runs the
-- exact same locking protocol inline (SELECT ... FOR UPDATE). This function is
-- the canonical reference implementation and is also callable directly via
-- Supabase RPC (PostgREST) for deployments without the Go service.
--
-- DESIGN: PESSIMISTIC LOCKING
--   1. Lock every affected inventory row with FOR UPDATE, ordered by product_id
--      to guarantee a deterministic lock acquisition order (prevents deadlocks
--      between concurrent checkouts touching overlapping product sets).
--   2. Validate stock under the lock.
--   3. Deduct, write the ledger, insert the order + items.
--   4. Idempotency: a repeated client_uuid returns the existing order instead
--      of double-charging (critical for offline sync retries).
-- ============================================================================

-- Input line shape (mirrors the JSON the client/engine sends):
--   [{ "product_id": "uuid", "quantity": 2 }, ...]

CREATE OR REPLACE FUNCTION app.process_checkout(
  p_client_uuid uuid,
  p_cashier_id  uuid,
  p_items       jsonb,
  p_sold_at     timestamptz DEFAULT now()
) RETURNS public.orders
LANGUAGE plpgsql AS $$
DECLARE
  v_existing      public.orders;
  v_order         public.orders;
  v_item          record;
  v_product       public.products;
  v_locked_qty    integer;
  v_line_total    numeric(12,2);
  v_line_tax      numeric(12,2);
  v_subtotal      numeric(12,2) := 0;
  v_tax_total     numeric(12,2) := 0;
  v_grand_total   numeric(12,2) := 0;
  v_new_qty       integer;
BEGIN
  -- ----- Idempotency guard: already processed? -----------------------------
  SELECT * INTO v_existing FROM public.orders WHERE client_uuid = p_client_uuid;
  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART' USING ERRCODE = 'check_violation';
  END IF;

  -- ----- 1 & 2: lock + validate in deterministic order ---------------------
  -- Acquiring locks ordered by product_id avoids deadlocks across concurrent
  -- transactions that share products.
  FOR v_item IN
    SELECT (elem ->> 'product_id')::uuid AS product_id,
           (elem ->> 'quantity')::int    AS quantity
    FROM jsonb_array_elements(p_items) elem
    ORDER BY (elem ->> 'product_id')::uuid
  LOOP
    IF v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY for product %', v_item.product_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_product FROM public.products
      WHERE id = v_item.product_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', v_item.product_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- PESSIMISTIC LOCK on the on-hand row.
    SELECT quantity INTO v_locked_qty
      FROM public.inventory
      WHERE product_id = v_item.product_id
      FOR UPDATE;

    IF v_locked_qty < v_item.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % requested % have %',
        v_item.product_id, v_item.quantity, v_locked_qty
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- ----- Create the order header (totals filled after lines) ---------------
  INSERT INTO public.orders (client_uuid, status, subtotal, tax_total, total, cashier_id, sold_at)
  VALUES (p_client_uuid, 'completed', 0, 0, 0, p_cashier_id, p_sold_at)
  RETURNING * INTO v_order;

  -- ----- 3: deduct, ledger, line items -------------------------------------
  FOR v_item IN
    SELECT (elem ->> 'product_id')::uuid AS product_id,
           (elem ->> 'quantity')::int    AS quantity
    FROM jsonb_array_elements(p_items) elem
    ORDER BY (elem ->> 'product_id')::uuid
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id = v_item.product_id;

    v_line_total := round(v_product.price * v_item.quantity, 2);
    v_line_tax   := round(v_line_total * v_product.tax_rate, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;

    UPDATE public.inventory
      SET quantity = quantity - v_item.quantity
      WHERE product_id = v_item.product_id
      RETURNING quantity INTO v_new_qty;

    INSERT INTO public.inventory_transactions
      (product_id, delta, resulting_qty, txn_type, order_id, actor_id, note)
    VALUES
      (v_item.product_id, -v_item.quantity, v_new_qty, 'sale', v_order.id, p_cashier_id, 'POS checkout');

    INSERT INTO public.order_items
      (order_id, product_id, sku, name, unit_price, tax_rate, quantity, line_total)
    VALUES
      (v_order.id, v_product.id, v_product.sku, v_product.name,
       v_product.price, v_product.tax_rate, v_item.quantity, v_line_total);
  END LOOP;

  v_grand_total := v_subtotal + v_tax_total;

  UPDATE public.orders
     SET subtotal = v_subtotal, tax_total = v_tax_total, total = v_grand_total
   WHERE id = v_order.id
   RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

COMMENT ON FUNCTION app.process_checkout(uuid, uuid, jsonb, timestamptz) IS
  'Atomic POS checkout with pessimistic row locking and client_uuid idempotency.';

-- ---------------------------------------------------------------------------
-- Restock / adjustment helper (also locks the row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.adjust_stock(
  p_product_id uuid,
  p_delta      integer,
  p_type       inventory_txn_type,
  p_actor_id   uuid,
  p_note       text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_qty integer;
  v_new integer;
BEGIN
  SELECT quantity INTO v_qty FROM public.inventory
    WHERE product_id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', p_product_id USING ERRCODE = 'no_data_found';
  END IF;

  v_new := v_qty + p_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: product % would go negative', p_product_id
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.inventory SET quantity = v_new WHERE product_id = p_product_id;

  INSERT INTO public.inventory_transactions
    (product_id, delta, resulting_qty, txn_type, actor_id, note)
  VALUES (p_product_id, p_delta, v_new, p_type, p_actor_id, p_note);

  RETURN v_new;
END;
$$;
