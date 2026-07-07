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
  upload_log_id  uuid REFERENCES upload_log(id) ON DELETE CASCADE,
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

-- Migration: เพิ่ม effective_from เพื่อ track batch ของแผน (checkpoint scheduling)
ALTER TABLE production_assignments ADD COLUMN IF NOT EXISTS effective_from timestamptz DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_assignments_effective ON production_assignments(production_date, period, effective_from DESC);

-- 14. Migration: เพิ่ม upload_round เพื่อแยก รอบ 8:00 / 13:00
ALTER TABLE daily_workforce   ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';
ALTER TABLE makro_orders      ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';
ALTER TABLE wet_market_orders ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';
ALTER TABLE lotus_orders      ADD COLUMN IF NOT EXISTS upload_round text DEFAULT '0800';

-- Migration: เพิ่ม source_file เพื่อ track ว่าข้อมูลมาจากไฟล์ไหน (ใช้ filter ใน download และ delete)
ALTER TABLE makro_orders      ADD COLUMN IF NOT EXISTS source_file text;
ALTER TABLE wet_market_orders ADD COLUMN IF NOT EXISTS source_file text;
ALTER TABLE lotus_orders      ADD COLUMN IF NOT EXISTS source_file text;

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

-- 17. บันทึกผลผลิตจริง (ถุง) — ใช้ใน สรุปแผนผลิต
CREATE TABLE IF NOT EXISTS production_actual (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  production_date date        NOT NULL,
  table_name      text        NOT NULL,
  sku             text        NOT NULL,
  quantity        integer     NOT NULL CHECK (quantity > 0),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_actual_date_table ON production_actual(production_date, table_name);
ALTER TABLE production_actual REPLICA IDENTITY FULL;
ALTER TABLE production_actual ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_actual" ON production_actual FOR ALL USING (true) WITH CHECK (true);

-- 18. รับผลได้ (Yield Bags) — เก็บผลจากไฟล์รับผลได้ รายวัน รายรหัส SAP
CREATE TABLE IF NOT EXISTS yield_bags (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date    date        NOT NULL,
  sap_code     text        NOT NULL,
  bags         integer     NOT NULL DEFAULT 0,
  source_file  text        NOT NULL,
  uploaded_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yield_bags_date ON yield_bags(work_date);
ALTER TABLE yield_bags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_yield_bags" ON yield_bags FOR ALL USING (true) WITH CHECK (true);

-- 19. แผนเข้างานประจำสัปดาห์ (Weekly Workforce Plan)
CREATE TABLE IF NOT EXISTS workforce_weekly (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  weekly_type    text        NOT NULL,  -- sa-phok-special | sam-chan-special | lai-special
  row_data       jsonb       NOT NULL DEFAULT '{}',
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workforce_weekly_type ON workforce_weekly(weekly_type);
CREATE INDEX IF NOT EXISTS idx_workforce_weekly_uploaded ON workforce_weekly(uploaded_at DESC);

ALTER TABLE workforce_weekly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_workforce_weekly" ON workforce_weekly FOR ALL USING (true) WITH CHECK (true);

-- 20. สถานะกำลังคนรายวันทับซ้อน (Daily Workforce Status Overrides)
CREATE TABLE IF NOT EXISTS workforce_daily_status (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date      text        NOT NULL, -- YYYY-MM-DD
  weekly_type    text        NOT NULL, -- sa-phok-special | sam-chan-special | lai-special
  worker_name    text        NOT NULL,
  status         text        NOT NULL, -- ทำงาน | วันหยุด | ลาป่วย | ลากิจ | ลาพักร้อน | อื่นๆ
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT uq_workforce_daily_status UNIQUE(work_date, weekly_type, worker_name)
);

CREATE INDEX IF NOT EXISTS idx_workforce_daily_status_lookup ON workforce_daily_status(work_date, weekly_type);

ALTER TABLE workforce_daily_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_workforce_daily_status" ON workforce_daily_status FOR ALL USING (true) WITH CHECK (true);

-- 21. Mas SKU ที่ไม่ต้องเบิกของ (No Withdrawal SKUs Master)
CREATE TABLE IF NOT EXISTS no_withdrawal_skus (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_station  TEXT,
  product_group TEXT,
  sap           TEXT NOT NULL,
  product_name  TEXT,
  source_file   TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_no_withdrawal_skus_sap ON no_withdrawal_skus(sap);
ALTER TABLE no_withdrawal_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_no_withdrawal_skus" ON no_withdrawal_skus FOR ALL USING (true) WITH CHECK (true);

-- 22. QC ตรวจอุณหภูมิ Lot หมูซีก (ห้อง Chill + อุณหภูมิ 18 จุด ต่อ Lot ต่อรอบ)
-- รอบนับเป็นรอบที่ 1, 2, 3, ... ไม่ได้ล็อกตามนาฬิกา — รอบจะหมดอายุ 1 ชม.
-- หลังจาก started_at ของรอบนั้น แล้วรอบใหม่จะเริ่มนับ started_at ใหม่ตอนมีการบันทึกครั้งแรกของรอบ
-- qc_check_rounds เป็นตาราง history (1 แถวต่อรอบ) ใช้ทำ dropdown ดูย้อนหลัง
CREATE TABLE IF NOT EXISTS qc_check_rounds (
  round_number int         PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO qc_check_rounds (round_number, started_at) VALUES (1, now()) ON CONFLICT (round_number) DO NOTHING;
ALTER TABLE qc_check_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_qc_check_rounds" ON qc_check_rounds FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS qc_lot_temperature_checks (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  spec_code    text        NOT NULL,
  chill_room   text,
  temps        jsonb       NOT NULL DEFAULT '{}',
  recorded_by  text,
  round_number int         NOT NULL DEFAULT 1,
  updated_at   timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_lot_temp_spec_roundnum ON qc_lot_temperature_checks(spec_code, round_number);
ALTER TABLE qc_lot_temperature_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_qc_lot_temp" ON qc_lot_temperature_checks FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS qc_lot_round_items (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  round_number int         NOT NULL,
  spec_code    text        NOT NULL,
  qty_3        numeric     DEFAULT 0,
  weight_3     numeric     DEFAULT 0,
  source_file  text,
  sort_order   int         DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_lot_round_items_round_spec ON qc_lot_round_items(round_number, spec_code);
CREATE INDEX IF NOT EXISTS idx_qc_lot_round_items_round ON qc_lot_round_items(round_number, sort_order);
ALTER TABLE qc_lot_round_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_qc_lot_round_items" ON qc_lot_round_items FOR ALL USING (true) WITH CHECK (true);

-- 23. Mas Yield สำหรับ Basic carcass yield ตามน้ำหนักซาก
CREATE TABLE IF NOT EXISTS mas_yield (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carcass_weight  numeric     NOT NULL,
  product_group   text        NOT NULL,
  yield_pct       numeric     NOT NULL,
  notes           text,
  source_file     text,
  upload_log_id   uuid REFERENCES upload_log(id) ON DELETE CASCADE,
  uploaded_at     timestamptz DEFAULT now()
);
ALTER TABLE mas_yield ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE mas_yield ADD COLUMN IF NOT EXISTS upload_log_id uuid REFERENCES upload_log(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_mas_yield_weight_group ON mas_yield(carcass_weight, product_group);
ALTER TABLE mas_yield ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_mas_yield" ON mas_yield;
CREATE POLICY "allow_all_mas_yield" ON mas_yield FOR ALL USING (true) WITH CHECK (true);

-- 23. Basic Line Breaks — บันทึกการหยุดสาย (Breakline) พร้อมสาเหตุและช่วงเวลา
CREATE TABLE IF NOT EXISTS basic_line_breaks (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  production_date date        NOT NULL,
  station         text        NOT NULL DEFAULT 'ทั้งหมด',
  start_time      text        NOT NULL,
  end_time        text        NOT NULL,
  reason          text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_basic_line_breaks_date ON basic_line_breaks(production_date);
ALTER TABLE basic_line_breaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_basic_line_breaks" ON basic_line_breaks FOR ALL USING (true) WITH CHECK (true);

-- 24. เบิกหมูซีก — ลำดับตัดแต่งที่เลือก (1 แถวเดียว, สถานะกลางให้ทุกเครื่องเห็นตรงกัน)
CREATE TABLE IF NOT EXISTS pig_carcass_lot_selection (
  id           smallint    PRIMARY KEY DEFAULT 1,
  selected     jsonb       NOT NULL DEFAULT '[]',
  trimming_qty text,
  updated_at   timestamptz DEFAULT now(),
  CONSTRAINT pig_carcass_lot_selection_singleton CHECK (id = 1)
);
INSERT INTO pig_carcass_lot_selection (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE pig_carcass_lot_selection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_pig_carcass_lot_selection" ON pig_carcass_lot_selection FOR ALL USING (true) WITH CHECK (true);

-- 25. กำลังคน + ทักษะ รวมทุกวัน (แทน daily_workforce/workforce_weekly/master_logic_manpower ใน plan generation)
-- sync อัตโนมัติทุก 8:05 (แล้วสร้างแผน Phase 1 ต่อทันที) จาก external Supabase project (ตาราง production_user, long format
-- 1 แถวต่อ employee+skill) โดย app/api/cron/sync-employee-skills ซึ่ง group เป็น 1 แถวต่อ
-- (work_date, emp_id) ก่อน insert — ไม่มีแถวของวันนั้น = ไม่ได้ทำงานวันนั้น (ไม่ต้องเช็ค day_off แยก)
CREATE TABLE IF NOT EXISTS employee_skills (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date        date,
  emp_id           text        NOT NULL,
  name             text        NOT NULL,
  department       text,
  work_station     text,       -- normalize แล้วตอน sync: สามชั้น/สะโพก/ไหล่/หมูบด/สไลด์/เผาขา/เลาะขา
  shift            text,       -- normalize แล้วตอน sync: 'กะ 1' (เช้า) / 'กะ 2' (บ่าย)
  is_weigher       boolean     NOT NULL DEFAULT false,
  skills           jsonb       NOT NULL DEFAULT '{}',  -- เฉพาะกลุ่มที่ can_do = true
  raw_work_station text,
  raw_shift        text,
  synced_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_skills_emp_id ON employee_skills(emp_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_work_date ON employee_skills(work_date);
ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_employee_skills" ON employee_skills FOR ALL USING (true) WITH CHECK (true);



