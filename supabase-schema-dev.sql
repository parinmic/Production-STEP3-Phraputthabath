-- ======================================================
-- สร้าง dev schema สำหรับ environment แยกจาก production (public schema)
-- รัน SQL นี้ใน Supabase > SQL Editor — สามารถรันซ้ำได้ (idempotent)
-- ======================================================

-- 1. สร้าง schema
CREATE SCHEMA IF NOT EXISTS dev;

-- 2. ให้ PostgREST roles เข้าถึง dev schema ได้
GRANT USAGE ON SCHEMA dev TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ตั้ง search_path สำหรับ session นี้ ทุก CREATE TABLE จะสร้างใน dev schema
SET search_path = dev;

-- ======================================================
-- Tables
-- ======================================================

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
  upload_round   text        DEFAULT '0800',
  uploaded_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workforce_date_station ON daily_workforce(work_date, work_station);
CREATE INDEX IF NOT EXISTS idx_workforce_round        ON daily_workforce(work_date, upload_round);
ALTER TABLE daily_workforce ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_workforce" ON daily_workforce;
CREATE POLICY "allow_all_workforce" ON daily_workforce FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS makro_orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_date    date,
  delivery_date date,
  sku           text        NOT NULL,
  sku_name      text,
  quantity      numeric     NOT NULL DEFAULT 0,
  period        text,
  upload_round  text        DEFAULT '0800',
  source_file   text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_makro_delivery_date ON makro_orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_makro_round         ON makro_orders(delivery_date, upload_round);
ALTER TABLE makro_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_makro" ON makro_orders;
CREATE POLICY "allow_all_makro" ON makro_orders FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS lotus_orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_date    date,
  delivery_date date,
  sku           text NOT NULL,
  sku_name      text,
  quantity      numeric NOT NULL DEFAULT 0,
  period        text,
  upload_round  text        DEFAULT '0800',
  source_file   text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lotus_delivery ON lotus_orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_lotus_round    ON lotus_orders(delivery_date, upload_round);
ALTER TABLE lotus_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_lotus" ON lotus_orders;
CREATE POLICY "allow_all_lotus" ON lotus_orders FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS wet_market_orders (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_date    date,
  delivery_date date,
  sku           text NOT NULL,
  sku_name      text,
  quantity      numeric NOT NULL DEFAULT 0,
  period        text,
  upload_round  text        DEFAULT '0800',
  source_file   text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wet_market_delivery ON wet_market_orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_wet_market_round    ON wet_market_orders(delivery_date, upload_round);
ALTER TABLE wet_market_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_wet_market" ON wet_market_orders;
CREATE POLICY "allow_all_wet_market" ON wet_market_orders FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS channel_quotas (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quota_date    date        NOT NULL,
  channel       text        NOT NULL,
  sku           text        NOT NULL,
  sku_name      text,
  quantity      numeric     NOT NULL DEFAULT 0,
  period        text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quota_date_channel ON channel_quotas(quota_date, channel);
ALTER TABLE channel_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_quota" ON channel_quotas;
CREATE POLICY "allow_all_quota" ON channel_quotas FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_assignments (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  production_date  date        NOT NULL,
  table_name       text        NOT NULL,
  worker_code      text        NOT NULL,
  worker_name      text        NOT NULL,
  sku              text        NOT NULL,
  sku_name         text,
  target_quantity  numeric     NOT NULL DEFAULT 0,
  unit             text        DEFAULT 'ชิ้น',
  period           text        NOT NULL DEFAULT 'เช้า',
  deadline_time    time,
  start_time       time,
  end_time         time,
  status           text        DEFAULT 'รอดำเนินการ',
  note             text,
  seq              integer,
  channel          text,
  effective_from   timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assignments_date_table ON production_assignments(production_date, table_name);
CREATE INDEX IF NOT EXISTS idx_assignments_worker      ON production_assignments(worker_code, production_date);
CREATE INDEX IF NOT EXISTS idx_assignments_effective   ON production_assignments(production_date, period, effective_from DESC);
ALTER TABLE production_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_assignments" ON production_assignments;
CREATE POLICY "allow_all_assignments" ON production_assignments FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  request_date  date        NOT NULL,
  phase         integer     NOT NULL CHECK (phase IN (1, 2, 3)),
  sku           text        NOT NULL,
  sku_name      text,
  quantity      numeric     NOT NULL DEFAULT 0,
  unit          text        DEFAULT 'ชิ้น',
  work_station  text,
  note          text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_withdrawal_date_phase ON withdrawal_requests(request_date, phase);
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_withdrawal" ON withdrawal_requests;
CREATE POLICY "allow_all_withdrawal" ON withdrawal_requests FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS upload_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name   text        NOT NULL,
  source_file  text        NOT NULL,
  record_count int         NOT NULL DEFAULT 0,
  uploaded_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upload_log_table_time ON upload_log(table_name, uploaded_at DESC);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_0010 (
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
CREATE INDEX IF NOT EXISTS idx_stock_0010_material ON stock_0010(material_code);
CREATE INDEX IF NOT EXISTS idx_stock_0010_uploaded ON stock_0010(uploaded_at DESC);
ALTER TABLE stock_0010 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_stock_0010" ON stock_0010;
CREATE POLICY "allow_all_stock_0010" ON stock_0010 FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

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
CREATE INDEX IF NOT EXISTS idx_stock_20_uploaded ON stock_20(uploaded_at DESC);
ALTER TABLE stock_20 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_stock_20" ON stock_20;
CREATE POLICY "allow_all_stock_20" ON stock_20 FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS master_logic_manpower (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_type  text        NOT NULL,
  row_data      jsonb       NOT NULL DEFAULT '{}',
  source_file   text,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_master_logic_manpower_type     ON master_logic_manpower(product_type);
CREATE INDEX IF NOT EXISTS idx_master_logic_manpower_uploaded ON master_logic_manpower(uploaded_at DESC);
ALTER TABLE master_logic_manpower ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_master_logic_manpower" ON master_logic_manpower;
CREATE POLICY "allow_all_master_logic_manpower" ON master_logic_manpower FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS master_logic_calculation (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  calculation_type  text        NOT NULL,
  row_data          jsonb       NOT NULL DEFAULT '{}',
  source_file       text,
  uploaded_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_master_logic_calc_type     ON master_logic_calculation(calculation_type);
CREATE INDEX IF NOT EXISTS idx_master_logic_calc_uploaded ON master_logic_calculation(uploaded_at DESC);
ALTER TABLE master_logic_calculation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_master_logic_calculation" ON master_logic_calculation;
CREATE POLICY "allow_all_master_logic_calculation" ON master_logic_calculation FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

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
DROP POLICY IF EXISTS "allow_all_bom_items" ON bom_items;
CREATE POLICY "allow_all_bom_items" ON bom_items FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_plan_100 (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_date      date,
  station        text NOT NULL,
  seq            int,
  step           text,
  unix_code      text,
  sap            text NOT NULL,
  product_name   text,
  weight_per_bag numeric DEFAULT 0,
  qty_bags       numeric DEFAULT 0,
  weight_total   numeric DEFAULT 0,
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
DROP POLICY IF EXISTS "allow_all_plan100" ON production_plan_100;
CREATE POLICY "allow_all_plan100" ON production_plan_100 FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS picking_unit_master (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step           text,
  unix_code      text,
  sap            text        NOT NULL,
  product_name   text,
  weight_per_bag numeric     NOT NULL DEFAULT 0,
  unit           text        NOT NULL DEFAULT 'ถุง',
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_picking_unit_sap ON picking_unit_master(sap);
ALTER TABLE picking_unit_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_picking_unit" ON picking_unit_master;
CREATE POLICY "allow_all_picking_unit" ON picking_unit_master FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

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
DROP POLICY IF EXISTS "allow_all_actual" ON production_actual;
CREATE POLICY "allow_all_actual" ON production_actual FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

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
DROP POLICY IF EXISTS "allow_all_yield_bags" ON yield_bags;
CREATE POLICY "allow_all_yield_bags" ON yield_bags FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_weekly (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  weekly_type    text        NOT NULL,
  row_data       jsonb       NOT NULL DEFAULT '{}',
  source_file    text,
  uploaded_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workforce_weekly_type     ON workforce_weekly(weekly_type);
CREATE INDEX IF NOT EXISTS idx_workforce_weekly_uploaded ON workforce_weekly(uploaded_at DESC);
ALTER TABLE workforce_weekly ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_workforce_weekly" ON workforce_weekly;
CREATE POLICY "allow_all_workforce_weekly" ON workforce_weekly FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_daily_status (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date      text        NOT NULL,
  weekly_type    text        NOT NULL,
  worker_name    text        NOT NULL,
  status         text        NOT NULL,
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT uq_workforce_daily_status UNIQUE(work_date, weekly_type, worker_name)
);
CREATE INDEX IF NOT EXISTS idx_workforce_daily_status_lookup ON workforce_daily_status(work_date, weekly_type);
ALTER TABLE workforce_daily_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_workforce_daily_status" ON workforce_daily_status;
CREATE POLICY "allow_all_workforce_daily_status" ON workforce_daily_status FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

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
DROP POLICY IF EXISTS "allow_all_no_withdrawal_skus" ON no_withdrawal_skus;
CREATE POLICY "allow_all_no_withdrawal_skus" ON no_withdrawal_skus FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS sku_master (
  sku         text PRIMARY KEY,
  sku_name    text        NOT NULL,
  table_name  text        NOT NULL,
  unit        text        DEFAULT 'ชิ้น',
  is_active   boolean     DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE sku_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_sku" ON sku_master;
CREATE POLICY "allow_all_sku" ON sku_master FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_plan_supplementary (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  slot          text        NOT NULL DEFAULT '1',
  sku           text        NOT NULL,
  sku_name      text,
  quantity      numeric     NOT NULL DEFAULT 0,
  order_date    date,
  delivery_date date,
  loading_time  text,
  deadline_time text,
  source_file   text        NOT NULL,
  uploaded_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supp_plan_slot        ON production_plan_supplementary(slot);
CREATE INDEX IF NOT EXISTS idx_supp_plan_source_file ON production_plan_supplementary(source_file);
ALTER TABLE production_plan_supplementary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_supp_plan" ON production_plan_supplementary;
CREATE POLICY "allow_all_supp_plan" ON production_plan_supplementary FOR ALL USING (true) WITH CHECK (true);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS qc_check_rounds (
  round_number int         PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO qc_check_rounds (round_number, started_at) VALUES (1, now()) ON CONFLICT (round_number) DO NOTHING;
ALTER TABLE qc_check_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_qc_check_rounds" ON qc_check_rounds;
CREATE POLICY "allow_all_qc_check_rounds" ON qc_check_rounds FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS qc_lot_temperature_checks (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  spec_code    text        NOT NULL,
  chill_room   text,
  temps        jsonb       NOT NULL DEFAULT '{}',
  round_number int         NOT NULL DEFAULT 1,
  updated_at   timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qc_lot_temp_spec_roundnum_dev ON qc_lot_temperature_checks(spec_code, round_number);
ALTER TABLE qc_lot_temperature_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_qc_lot_temp" ON qc_lot_temperature_checks;
CREATE POLICY "allow_all_qc_lot_temp" ON qc_lot_temperature_checks FOR ALL USING (true) WITH CHECK (true);

-- ======================================================
-- Realtime (ถ้าใช้ Supabase Realtime สำหรับ dev ด้วย)
-- ไปที่ Supabase Dashboard > Database > Replication
-- เพิ่ม dev.production_actual เข้า publication supabase_realtime
-- ======================================================
