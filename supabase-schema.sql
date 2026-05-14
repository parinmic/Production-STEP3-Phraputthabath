-- ======================================================
-- ระบบคำสั่งผลิต — Production System Database Schema
-- รัน SQL นี้ใน Supabase > SQL Editor
-- ======================================================

-- 1. กำลังคนประจำวัน (Daily Workforce)
-- รองรับ Excel format: plan_id, emp_id, name, home_dept, target_dept, work_station, shift, required_skill
CREATE TABLE IF NOT EXISTS daily_workforce (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date      date        NOT NULL,
  plan_id        integer,
  emp_id         text        NOT NULL,
  name           text        NOT NULL,
  home_dept      text,
  target_dept    text,
  work_station   text,
  shift          text,
  required_skill text,
  uploaded_at    timestamptz DEFAULT now()
);

-- Index สำหรับ query รายวัน-รายสถานี
CREATE INDEX IF NOT EXISTS idx_workforce_date_station
  ON daily_workforce(work_date, work_station);

-- Migration: ถ้า table เดิมมีอยู่แล้วให้รัน ALTER เหล่านี้แทน
-- ALTER TABLE daily_workforce ADD COLUMN IF NOT EXISTS plan_id integer;
-- ALTER TABLE daily_workforce ADD COLUMN IF NOT EXISTS emp_id text;
-- ALTER TABLE daily_workforce ADD COLUMN IF NOT EXISTS home_dept text;
-- ALTER TABLE daily_workforce ADD COLUMN IF NOT EXISTS target_dept text;
-- ALTER TABLE daily_workforce ADD COLUMN IF NOT EXISTS work_station text;
-- ALTER TABLE daily_workforce ADD COLUMN IF NOT EXISTS required_skill text;
-- ALTER TABLE daily_workforce RENAME COLUMN worker_code TO emp_id;  -- ถ้าต้องการ
-- ALTER TABLE daily_workforce RENAME COLUMN worker_name TO name;    -- ถ้าต้องการ

-- 2. คำสั่งซื้อล่วงหน้า Makro
CREATE TABLE IF NOT EXISTS makro_orders (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_date      date        NOT NULL,
  delivery_date   date,
  sku             text        NOT NULL,
  sku_name        text,
  quantity        numeric     NOT NULL DEFAULT 0,
  period          text,       -- เช้า | บ่าย | ค่ำ
  uploaded_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_makro_delivery_date
  ON makro_orders(delivery_date);

-- 3. Quota ทุกช่องทางขาย
CREATE TABLE IF NOT EXISTS channel_quotas (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quota_date      date        NOT NULL,
  channel         text        NOT NULL,  -- Makro | 7-11 | Tops | ฯลฯ
  sku             text        NOT NULL,
  sku_name        text,
  quantity        numeric     NOT NULL DEFAULT 0,
  period          text,
  uploaded_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quota_date_channel
  ON channel_quotas(quota_date, channel);

-- 4. คำสั่งผลิตรายคน (Production Assignments)
-- ตารางนี้ถูก generate จากการคำนวณ กำลังคน + Quota
CREATE TABLE IF NOT EXISTS production_assignments (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  production_date  date        NOT NULL,
  table_name       text        NOT NULL,   -- สามชั้น | สะโพก | ไหล่
  worker_code      text        NOT NULL,
  worker_name      text        NOT NULL,
  sku              text        NOT NULL,
  sku_name         text,
  target_quantity  numeric     NOT NULL DEFAULT 0,
  unit             text        DEFAULT 'ชิ้น',
  period           text        NOT NULL DEFAULT 'เช้า',  -- เช้า | บ่าย
  deadline_time    time,       -- เวลาที่ต้องทำเสร็จ
  status           text        DEFAULT 'รอดำเนินการ',  -- รอดำเนินการ | กำลังผลิต | เสร็จแล้ว
  note             text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assignments_date_table
  ON production_assignments(production_date, table_name);
CREATE INDEX IF NOT EXISTS idx_assignments_worker
  ON production_assignments(worker_code, production_date);

-- 5. รายการเบิกสินค้า (Withdrawal Requests)
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  request_date    date        NOT NULL,
  phase           integer     NOT NULL CHECK (phase IN (1, 2, 3)),  -- 1=เช้า 2=บ่าย 3=ค่ำ
  sku             text        NOT NULL,
  sku_name        text,
  quantity        numeric     NOT NULL DEFAULT 0,
  unit            text        DEFAULT 'ชิ้น',
  work_station    text,       -- สามชั้น | สะโพก | ไหล่
  note            text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_date_phase
  ON withdrawal_requests(request_date, phase);

CREATE POLICY "allow_all_withdrawal" ON withdrawal_requests FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- 6. SKU Master (ข้อมูลสินค้า)
CREATE TABLE IF NOT EXISTS sku_master (
  sku         text PRIMARY KEY,
  sku_name    text        NOT NULL,
  table_name  text        NOT NULL,  -- โต้ะที่ผลิต SKU นี้
  unit        text        DEFAULT 'ชิ้น',
  is_active   boolean     DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

-- ข้อมูลตัวอย่าง SKU (แก้ไขตามจริง)
INSERT INTO sku_master (sku, sku_name, table_name) VALUES
  ('SKU-001', 'ชิ้นส่วนสามชั้น A', 'สามชั้น'),
  ('SKU-002', 'ชิ้นส่วนสามชั้น B', 'สามชั้น'),
  ('SKU-003', 'ชิ้นส่วนสะโพก A',  'สะโพก'),
  ('SKU-004', 'ชิ้นส่วนสะโพก B',  'สะโพก'),
  ('SKU-005', 'ชิ้นส่วนไหล่ A',   'ไหล่'),
  ('SKU-006', 'ชิ้นส่วนไหล่ B',   'ไหล่')
ON CONFLICT (sku) DO NOTHING;

-- 6. Upload Log (บันทึกประวัติการอัพโหลด)
CREATE TABLE IF NOT EXISTS upload_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name   text        NOT NULL,
  source_file  text        NOT NULL,
  record_count int         NOT NULL DEFAULT 0,
  uploaded_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_log_table_time
  ON upload_log(table_name, uploaded_at DESC);

-- 7. Stock Raw Material — STOCK 0010
CREATE TABLE IF NOT EXISTS stock_0010 (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  material_code  text,            -- รหัสสินค้า (หน่วยสินค้า)
  material_name  text,            -- ชื่อสินค้า (หน่วยบรรจุ)
  spec_code      text,            -- รหัส Spec / Lot
  qty_1          numeric DEFAULT 0,
  weight_1       numeric DEFAULT 0,
  qty_2          numeric DEFAULT 0,
  weight_2       numeric DEFAULT 0,
  qty_3          numeric DEFAULT 0,
  weight_3       numeric DEFAULT 0,
  qty_total      numeric DEFAULT 0,
  weight_total   numeric DEFAULT 0,
  unit           text,
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_0010_material ON stock_0010(material_code);
CREATE INDEX IF NOT EXISTS idx_stock_0010_uploaded ON stock_0010(uploaded_at DESC);

-- 8. Stock Raw Material — STOCK 20
CREATE TABLE IF NOT EXISTS stock_20 (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  material_code  text,
  material_name  text,
  spec_code      text,
  qty_1          numeric DEFAULT 0,
  weight_1       numeric DEFAULT 0,
  qty_2          numeric DEFAULT 0,
  weight_2       numeric DEFAULT 0,
  qty_3          numeric DEFAULT 0,
  weight_3       numeric DEFAULT 0,
  qty_total      numeric DEFAULT 0,
  weight_total   numeric DEFAULT 0,
  unit           text,
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_20_material ON stock_20(material_code);
CREATE INDEX IF NOT EXISTS idx_stock_20_uploaded  ON stock_20(uploaded_at DESC);

-- 9. Master Logic กำลังคน (Manpower Master Logic)
CREATE TABLE IF NOT EXISTS master_logic_manpower (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_type  text        NOT NULL,  -- สะโพกพิเศษ | ไหล่พิเศษ | สามชั้นพิเศษ
  row_data      jsonb       NOT NULL DEFAULT '{}',
  source_file   text,
  uploaded_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_logic_manpower_type
  ON master_logic_manpower(product_type);
CREATE INDEX IF NOT EXISTS idx_master_logic_manpower_uploaded
  ON master_logic_manpower(uploaded_at DESC);

-- 10. Master Logic Calculation
CREATE TABLE IF NOT EXISTS master_logic_calculation (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  calculation_type  text        NOT NULL,  -- Mas Productivity | Mas %Variance Makro | ...
  row_data          jsonb       NOT NULL DEFAULT '{}',
  source_file       text,
  uploaded_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_logic_calc_type
  ON master_logic_calculation(calculation_type);
CREATE INDEX IF NOT EXISTS idx_master_logic_calc_uploaded
  ON master_logic_calculation(uploaded_at DESC);

-- ======================================================
-- Enable Row Level Security (ปลอดภัยขึ้น)
-- ======================================================
ALTER TABLE daily_workforce       ENABLE ROW LEVEL SECURITY;
ALTER TABLE makro_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_quotas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_master            ENABLE ROW LEVEL SECURITY;

-- อนุญาตให้ anon key อ่าน-เขียนได้ (ปรับตาม security ที่ต้องการในภายหลัง)
CREATE POLICY "allow_all_workforce"    ON daily_workforce        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_makro"        ON makro_orders           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_quota"        ON channel_quotas         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_assignments"  ON production_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sku"          ON sku_master             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_upload_log"   ON upload_log             FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE stock_0010  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_20    ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_stock_0010"   ON stock_0010             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_stock_20"     ON stock_20               FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE master_logic_manpower ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_master_logic_manpower" ON master_logic_manpower FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE master_logic_calculation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_master_logic_calculation" ON master_logic_calculation FOR ALL USING (true) WITH CHECK (true);

-- 11. คำสั่งซื้อ LOTUS
CREATE TABLE IF NOT EXISTS lotus_orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_date    date,
  delivery_date date,
  sku           text NOT NULL,
  sku_name      text,
  quantity      numeric NOT NULL DEFAULT 0,
  period        text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lotus_delivery ON lotus_orders(delivery_date);
ALTER TABLE lotus_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_lotus" ON lotus_orders FOR ALL USING (true) WITH CHECK (true);

-- 12. คำสั่งซื้อ Wet Market
CREATE TABLE IF NOT EXISTS wet_market_orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_date    date,
  delivery_date date,
  sku           text NOT NULL,
  sku_name      text,
  quantity      numeric NOT NULL DEFAULT 0,
  period        text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wet_market_delivery ON wet_market_orders(delivery_date);
ALTER TABLE wet_market_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_wet_market" ON wet_market_orders FOR ALL USING (true) WITH CHECK (true);

-- 13. BOM สินค้า (Bill of Materials)
CREATE TABLE IF NOT EXISTS bom_items (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pg            INT,
  pg_name       TEXT,
  product_code  TEXT,
  product_sap   TEXT NOT NULL,
  product_name  TEXT,
  raw_code      TEXT,
  raw_sap       TEXT,
  raw_name      TEXT,
  yield_pct     FLOAT DEFAULT 0,
  loss_pct      FLOAT DEFAULT 0,
  by_products   JSONB DEFAULT '[]',
  uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_product_sap ON bom_items(product_sap);
CREATE INDEX IF NOT EXISTS idx_bom_raw_sap     ON bom_items(raw_sap);

ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_bom_items" ON bom_items FOR ALL USING (true) WITH CHECK (true);

-- 15. Migration: เพิ่ม seq เพื่อเก็บลำดับงานของแต่ละพนักงาน
ALTER TABLE production_assignments ADD COLUMN IF NOT EXISTS seq integer;

-- Migration: เพิ่ม channel เพื่อ track ว่างานมาจากช่องทางไหน (Wet Market / LOTUS / Makro / plan100)
ALTER TABLE production_assignments ADD COLUMN IF NOT EXISTS channel text;

-- 14. Migration: เพิ่ม upload_round เพื่อแยก รอบ 8:00 / 13:00
ALTER TABLE daily_workforce   ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';
ALTER TABLE makro_orders      ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';
ALTER TABLE wet_market_orders ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';
ALTER TABLE lotus_orders      ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';

-- 15. แผนผลิต 100% (Production Plan 100%)
CREATE TABLE IF NOT EXISTS production_plan_100 (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_date      date,
  station        text NOT NULL,   -- สายพานสะโพก | สายพานสามชั้น | สายพานไหล่ | etc.
  seq            int,
  step           text,
  unix_code      text,
  sap            text NOT NULL,
  product_name   text,
  weight_per_bag numeric DEFAULT 0,
  qty_bags       numeric DEFAULT 0,
  weight_total   numeric DEFAULT 0,  -- ปริมาณผลิตรวม (กก.) — ใช้คำนวณ Phase 3
  lotus_bags     numeric DEFAULT 0,
  lotus_weight   numeric DEFAULT 0,
  cpft_bags      numeric DEFAULT 0,
  cpft_weight    numeric DEFAULT 0,
  makro_bags     numeric DEFAULT 0,
  makro_weight   numeric DEFAULT 0,
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan100_date    ON production_plan_100(plan_date);
CREATE INDEX IF NOT EXISTS idx_plan100_station ON production_plan_100(plan_date, station);

ALTER TABLE production_plan_100 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_plan100" ON production_plan_100 FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_workforce_round    ON daily_workforce(work_date, upload_round);
CREATE INDEX IF NOT EXISTS idx_makro_round        ON makro_orders(delivery_date, upload_round);
CREATE INDEX IF NOT EXISTS idx_wet_market_round   ON wet_market_orders(delivery_date, upload_round);
CREATE INDEX IF NOT EXISTS idx_lotus_round        ON lotus_orders(delivery_date, upload_round);

-- 16. Mas หน่วยหยิบสินค้า — เทียบ กก. เป็นจำนวนถุง/หน่วย
CREATE TABLE IF NOT EXISTS picking_unit_master (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step           text,
  unix_code      text,
  sap            text        NOT NULL,
  product_name   text,
  weight_per_bag numeric     NOT NULL DEFAULT 0,  -- กก. ต่อถุง
  unit           text        NOT NULL DEFAULT 'ถุง',
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);

-- Migration: ถ้า table เดิมมีอยู่แล้ว ให้รัน ALTER เหล่านี้
-- ALTER TABLE picking_unit_master ADD COLUMN IF NOT EXISTS step text;
-- ALTER TABLE picking_unit_master ADD COLUMN IF NOT EXISTS unix_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_picking_unit_sap ON picking_unit_master(sap);

ALTER TABLE picking_unit_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_picking_unit" ON picking_unit_master FOR ALL USING (true) WITH CHECK (true);
