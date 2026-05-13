import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const PERIOD: Record<string, string> = { '1': 'เช้า', '2': 'บ่าย', '3': 'ค่ำ' }

export async function POST(req: NextRequest) {
  const { date, phase } = await req.json()
  const period = PERIOD[String(phase)]
  if (!date || !period) return NextResponse.json({ error: 'missing params' }, { status: 400 })

  // 1. ดึง production_assignments ของวันนี้ + phase นี้
  const { data: assignments, error: e1 } = await supabase
    .from('production_assignments')
    .select('table_name, sku, sku_name, target_quantity')
    .eq('production_date', date)
    .eq('period', period)

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (!assignments?.length) {
    return NextResponse.json({
      items: [],
      message: `ไม่พบคำสั่งผลิต Phase ${phase} วันที่ ${date}`,
    })
  }

  // 2. รวม target_quantity ต่อ (station, finished_sku)
  const finMap = new Map<string, { station: string; sku: string; sku_name: string | null; qty: number }>()
  const skuSet = new Set<string>()

  for (const a of assignments) {
    const key = `${a.table_name}|||${a.sku}`
    const cur = finMap.get(key)
    if (cur) {
      cur.qty += Number(a.target_quantity)
    } else {
      finMap.set(key, {
        station: a.table_name,
        sku: a.sku,
        sku_name: a.sku_name ?? null,
        qty: Number(a.target_quantity),
      })
    }
    skuSet.add(a.sku)
  }

  // 3. ดึง BOM สำหรับ finished goods SKU เหล่านี้
  const skus = Array.from(skuSet)
  const { data: bomRows, error: e2 } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', skus)

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  // bomMap: product_sap → [{ raw_sap, raw_name, yield_pct }]
  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
    bomMap.set(b.product_sap, list)
  }

  // 4. คำนวณปริมาณวัตถุดิบ: raw_qty = finished_qty / (yield_pct / 100)
  const rawMap = new Map<string, { station: string; raw_sap: string; raw_name: string | null; qty: number }>()
  const noBom: { station: string; sku: string; sku_name: string | null; qty: number }[] = []

  for (const { station, sku, sku_name, qty } of Array.from(finMap.values())) {
    const boms = bomMap.get(sku)
    if (!boms?.length) {
      noBom.push({ station, sku, sku_name, qty })
      continue
    }
    for (const b of boms) {
      const rawQty = b.yield_pct > 0 ? qty / (b.yield_pct / 100) : qty
      const key = `${station}|||${b.raw_sap}`
      const cur = rawMap.get(key)
      if (cur) {
        cur.qty += rawQty
      } else {
        rawMap.set(key, { station, raw_sap: b.raw_sap, raw_name: b.raw_name, qty: rawQty })
      }
    }
  }

  // 5. สร้าง output items (ปัดเศษ 2 ตำแหน่ง)
  const items = [
    ...Array.from(rawMap.values() as Iterable<{ station: string; raw_sap: string; raw_name: string | null; qty: number }>).map(({ station, raw_sap, raw_name, qty }) => ({
      sku: raw_sap,
      sku_name: raw_name,
      quantity: Math.round(qty * 100) / 100,
      unit: 'กก.',
      work_station: station,
      note: 'คำนวณจาก BOM',
    })),
    ...noBom.map(({ station, sku, sku_name, qty }) => ({
      sku,
      sku_name,
      quantity: Math.round(qty * 100) / 100,
      unit: 'กก.',
      work_station: station,
      note: 'ไม่พบ BOM — ใช้ปริมาณผลิตโดยตรง',
    })),
  ].sort((a, b) =>
    (a.work_station ?? '').localeCompare(b.work_station ?? '') ||
    (a.sku ?? '').localeCompare(b.sku ?? '')
  )

  return NextResponse.json({ items })
}
