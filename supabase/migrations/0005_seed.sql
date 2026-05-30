-- ============================================================================
-- 0005_seed.sql
--
-- Development seed data. Safe to run repeatedly (ON CONFLICT DO NOTHING).
-- In the docker-compose local stack this gives the POS something to scan.
-- DO NOT rely on this in production (guarded by API_ENV in real deploys).
-- ============================================================================

INSERT INTO public.products (id, sku, barcode, name, description, price, cost, tax_rate)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'SKU-COLA-330', '5449000000996', 'Cola Can 330ml',     'Classic cola, chilled',        1.50, 0.60, 0.0700),
  ('22222222-2222-2222-2222-222222222222', 'SKU-WATER-500','4006381333931', 'Spring Water 500ml',  'Still mineral water',          0.90, 0.30, 0.0700),
  ('33333333-3333-3333-3333-333333333333', 'SKU-CHIP-150', '7622210449283', 'Potato Chips 150g',   'Salted potato chips',          2.20, 0.95, 0.0700),
  ('44444444-4444-4444-4444-444444444444', 'SKU-CHOC-100', '3017620422003', 'Chocolate Bar 100g',  'Milk chocolate',               2.80, 1.10, 0.0700),
  ('55555555-5555-5555-5555-555555555555', 'SKU-COFFEE',   '8710398526564', 'Ground Coffee 250g',  'Medium roast arabica',         6.50, 3.20, 0.0700),
  ('66666666-6666-6666-6666-666666666666', 'SKU-GUM-10',   '7613034626844', 'Chewing Gum 10pk',    'Spearmint gum',                1.10, 0.40, 0.0700)
ON CONFLICT (id) DO NOTHING;

-- Set opening stock + reorder levels (inventory rows auto-created by trigger).
UPDATE public.inventory SET quantity = 200, reorder_level = 24 WHERE product_id = '11111111-1111-1111-1111-111111111111';
UPDATE public.inventory SET quantity = 300, reorder_level = 36 WHERE product_id = '22222222-2222-2222-2222-222222222222';
UPDATE public.inventory SET quantity = 120, reorder_level = 20 WHERE product_id = '33333333-3333-3333-3333-333333333333';
UPDATE public.inventory SET quantity =  80, reorder_level = 15 WHERE product_id = '44444444-4444-4444-4444-444444444444';
UPDATE public.inventory SET quantity =  45, reorder_level = 10 WHERE product_id = '55555555-5555-5555-5555-555555555555';
UPDATE public.inventory SET quantity = 500, reorder_level = 50 WHERE product_id = '66666666-6666-6666-6666-666666666666';

-- Record the opening balances in the ledger for audit completeness.
INSERT INTO public.inventory_transactions (product_id, delta, resulting_qty, txn_type, note)
SELECT i.product_id, i.quantity, i.quantity, 'restock', 'Opening balance (seed)'
FROM public.inventory i
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory_transactions t WHERE t.product_id = i.product_id
);
