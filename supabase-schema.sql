-- ======================================================
-- ระบบคำสั่งผลิต — Production System Database Schema
-- รัน SQL นี้ใน Supabase > SQL Editor
-- ======================================================

-- 1. กำลังคนประจำวัน (Daily Workforce)
CREATE TABLE IF NOT EXISTS daily_workforce (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  work_date   date        NOT NULL,
  table_name  text        NOT NULL,  -- สามชั้น | สะโพก | ไหล่
  worker_code text        NOT NULL,
  worker_name text        NOT NULL,
  shift       text        DEFAULT 'เช้า',  -- เช้า | บ่าย | ค่ำ
  uploaded_at timestamptz DEFAULT now()
);

-- Index สำหรับ query รายวัน-รายโต้ะ
CREATE INDEX IF NOT EXISTS idx_workforce_date_table
  ON daily_workforce(work_date, table_name);

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

-- 5. SKU Master (ข้อมูลสินค้า)
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
