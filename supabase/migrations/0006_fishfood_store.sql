-- ============================================================================
-- 0006_fishfood_store.sql
--
-- Adapts the generic POS into a complete FISH-FOOD STORE (ร้านขายอาหารปลา).
--   * adds a product `category` for browsing/filtering
--   * replaces the demo catalog with a realistic fish-food product range
--   * prices are in THB (฿); tax_rate 0.07 = Thai VAT 7%
--
-- Idempotent: safe to re-run. Audit triggers + RLS from earlier migrations
-- apply automatically to every change here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Product category (nullable, indexed). Old rows default to 'อื่นๆ' (Other).
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'อื่นๆ';

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Remove the old generic demo catalog (kiosk snacks) if present, so the store
-- shows only fish-food products. The ledger / order_items reference products
-- with ON DELETE RESTRICT, so clear those demo references first. (These demo
-- rows only ever exist from 0005_seed.sql in dev — never real sales.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_demo uuid[] := ARRAY[
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    '66666666-6666-6666-6666-666666666666'
  ]::uuid[];
BEGIN
  DELETE FROM public.inventory_transactions WHERE product_id = ANY(v_demo);
  DELETE FROM public.order_items            WHERE product_id = ANY(v_demo);
  DELETE FROM public.inventory              WHERE product_id = ANY(v_demo);
  DELETE FROM public.products               WHERE id          = ANY(v_demo);
END
$$;

-- ---------------------------------------------------------------------------
-- Fish-food catalog. Categories:
--   อาหารปลาสวยงาม  (ornamental / aquarium fish food)
--   อาหารปลากินพืช   (herbivore fish food)
--   อาหารปลาทอง      (goldfish food)
--   อาหารปลาคาร์ฟ    (koi food)
--   อาหารปลาดุก/เลี้ยง (catfish / farm fish food)
--   อาหารลูกปลา/ผง   (fry / powdered food)
--   อุปกรณ์เสริม     (accessories: nets, conditioners)
-- ---------------------------------------------------------------------------
INSERT INTO public.products (id, sku, barcode, name, description, category, price, cost, tax_rate)
VALUES
  ('a0000001-0000-4000-8000-000000000001', 'FF-BETTA-20',  '8850001000017', 'อาหารปลากัด ชนิดเม็ด 20g',        'เม็ดลอยน้ำ โปรตีนสูง สำหรับปลากัด',     'อาหารปลาสวยงาม',  45.00, 18.00, 0.0700),
  ('a0000002-0000-4000-8000-000000000002', 'FF-GUPPY-50',  '8850001000024', 'อาหารปลาหางนกยูง 50g',            'เม็ดเล็กพิเศษ เร่งสี',                  'อาหารปลาสวยงาม',  65.00, 28.00, 0.0700),
  ('a0000003-0000-4000-8000-000000000003', 'FF-TROPIC-100','8850001000031', 'อาหารปลาเขตร้อนรวม 100g',         'แผ่นเกล็ด สำหรับตู้ปลารวม',             'อาหารปลาสวยงาม', 120.00, 55.00, 0.0700),
  ('a0000004-0000-4000-8000-000000000004', 'FF-FLOWER-250','8850001000048', 'อาหารปลาหมอสีเร่งสี 250g',        'เม็ดกลาง เร่งสี เร่งโหนก',              'อาหารปลาสวยงาม', 180.00, 90.00, 0.0700),
  ('a0000005-0000-4000-8000-000000000005', 'FF-ALGAE-120', '8850001000055', 'อาหารปลากินสาหร่าย/ตะไคร่ 120g',  'แผ่นสาหร่ายสไปรูลิน่า สำหรับปลากินพืช', 'อาหารปลากินพืช',  95.00, 42.00, 0.0700),
  ('a0000006-0000-4000-8000-000000000006', 'FF-PLECO-100', '8850001000062', 'อาหารปลาซัคเกอร์ ชนิดจม 100g',    'เม็ดจมน้ำ สำหรับปลากินพื้น',            'อาหารปลากินพืช',  85.00, 38.00, 0.0700),
  ('a0000007-0000-4000-8000-000000000007', 'FF-GOLD-200',  '8850001000079', 'อาหารปลาทอง สูตรลอยน้ำ 200g',     'เม็ดลอยน้ำ ไม่ทำให้น้ำขุ่น',           'อาหารปลาทอง',    110.00, 48.00, 0.0700),
  ('a0000008-0000-4000-8000-000000000008', 'FF-GOLD-1KG',  '8850001000086', 'อาหารปลาทอง ถุงประหยัด 1kg',      'เม็ดลอยน้ำ ขนาดถุงใหญ่ คุ้มค่า',        'อาหารปลาทอง',    320.00,160.00, 0.0700),
  ('a0000009-0000-4000-8000-000000000009', 'FF-KOI-S-1KG', '8850001000093', 'อาหารปลาคาร์ฟ เม็ดเล็ก 1kg',      'สูตรเร่งโต เม็ดเล็ก สำหรับคาร์ฟเล็ก',  'อาหารปลาคาร์ฟ',   350.00,175.00, 0.0700),
  ('a000000a-0000-4000-8000-00000000000a', 'FF-KOI-L-5KG', '8850001000109', 'อาหารปลาคาร์ฟ เม็ดใหญ่ 5kg',      'สูตรเร่งสี+เร่งโต กระสอบ 5 กิโล',       'อาหารปลาคาร์ฟ',  1450.00,720.00, 0.0700),
  ('a000000b-0000-4000-8000-00000000000b', 'FF-CAT-2KG',   '8850001000116', 'อาหารปลาดุก โปรตีน 30% 2kg',      'เม็ดจม สำหรับปลาดุก/ปลาเลี้ยง',         'อาหารปลาดุก',     95.00, 45.00, 0.0700),
  ('a000000c-0000-4000-8000-00000000000c', 'FF-CAT-10KG',  '8850001000123', 'อาหารปลาดุก กระสอบ 10kg',         'สูตรฟาร์ม เม็ดจม ขนาดกระสอบ',          'อาหารปลาดุก',    420.00,210.00, 0.0700),
  ('a000000d-0000-4000-8000-00000000000d', 'FF-FRY-40',    '8850001000130', 'อาหารลูกปลา ชนิดผง 40g',          'ผงละเอียด สำหรับลูกปลาแรกเกิด',        'อาหารลูกปลา',     55.00, 22.00, 0.0700),
  ('a000000e-0000-4000-8000-00000000000e', 'FF-BLOODW-30', '8850001000147', 'หนอนแดงอบแห้ง 30g',               'อาหารโปรตีนสูง เสริมการเจริญเติบโต',    'อาหารลูกปลา',     75.00, 33.00, 0.0700),
  ('a000000f-0000-4000-8000-00000000000f', 'AC-NET-S',     '8850001000154', 'สวิงตักปลา ขนาดเล็ก',             'อุปกรณ์ตักปลา ด้ามไม้',                 'อุปกรณ์เสริม',     35.00, 12.00, 0.0700),
  ('a0000010-0000-4000-8000-000000000010', 'AC-COND-500',  '8850001000161', 'น้ำยาปรับสภาพน้ำ 500ml',          'ลดคลอรีน ปรับสภาพน้ำตู้ปลา',           'อุปกรณ์เสริม',    120.00, 55.00, 0.0700)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Opening stock + reorder levels.
-- ---------------------------------------------------------------------------
UPDATE public.inventory SET quantity = 120, reorder_level = 24 WHERE product_id = 'a0000001-0000-4000-8000-000000000001';
UPDATE public.inventory SET quantity = 100, reorder_level = 20 WHERE product_id = 'a0000002-0000-4000-8000-000000000002';
UPDATE public.inventory SET quantity =  80, reorder_level = 16 WHERE product_id = 'a0000003-0000-4000-8000-000000000003';
UPDATE public.inventory SET quantity =  60, reorder_level = 12 WHERE product_id = 'a0000004-0000-4000-8000-000000000004';
UPDATE public.inventory SET quantity =  90, reorder_level = 18 WHERE product_id = 'a0000005-0000-4000-8000-000000000005';
UPDATE public.inventory SET quantity =  70, reorder_level = 14 WHERE product_id = 'a0000006-0000-4000-8000-000000000006';
UPDATE public.inventory SET quantity = 150, reorder_level = 30 WHERE product_id = 'a0000007-0000-4000-8000-000000000007';
UPDATE public.inventory SET quantity =  60, reorder_level = 12 WHERE product_id = 'a0000008-0000-4000-8000-000000000008';
UPDATE public.inventory SET quantity =  50, reorder_level = 10 WHERE product_id = 'a0000009-0000-4000-8000-000000000009';
UPDATE public.inventory SET quantity =  20, reorder_level =  5 WHERE product_id = 'a000000a-0000-4000-8000-00000000000a';
UPDATE public.inventory SET quantity = 100, reorder_level = 20 WHERE product_id = 'a000000b-0000-4000-8000-00000000000b';
UPDATE public.inventory SET quantity =  40, reorder_level =  8 WHERE product_id = 'a000000c-0000-4000-8000-00000000000c';
UPDATE public.inventory SET quantity = 110, reorder_level = 22 WHERE product_id = 'a000000d-0000-4000-8000-00000000000d';
UPDATE public.inventory SET quantity =  85, reorder_level = 18 WHERE product_id = 'a000000e-0000-4000-8000-00000000000e';
UPDATE public.inventory SET quantity =  45, reorder_level = 10 WHERE product_id = 'a000000f-0000-4000-8000-00000000000f';
UPDATE public.inventory SET quantity =  65, reorder_level = 14 WHERE product_id = 'a0000010-0000-4000-8000-000000000010';

-- Record opening balances in the ledger for any product without history yet.
INSERT INTO public.inventory_transactions (product_id, delta, resulting_qty, txn_type, note)
SELECT i.product_id, i.quantity, i.quantity, 'restock', 'ยอดยกมา (เริ่มต้นระบบ)'
FROM public.inventory i
WHERE i.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions t WHERE t.product_id = i.product_id
  );
