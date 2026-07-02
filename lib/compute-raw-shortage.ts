import { supabase } from '@/lib/supabase'

export interface RawShortageRow {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  deficit: number | null
  productionTime: string | null
  work_station: string | null
}

const PERIOD_MAP: Record<string, string> = {
  '1': 'เช้า',
  '2': 'บ่าย',
  '3': 'ค่ำ',
}

const MAIN_STATIONS = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์', 'เผาขา', 'เลาะขา']

function parseNoteTotal(note: string | null): number {
  if (!note) return 0
  const clean = note.split('|')[0]
  if (!clean.startsWith('rounds:')) return 0
  return clean.replace('rounds:', '').split(';').reduce((s, p) => {
    const [, q] = p.split('=')
    return s + (parseFloat(q) || 0)
  }, 0)
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s*-\s*/g, '-')
}

export async function computeRawShortageRows(date: string, phase: string | number): Promise<RawShortageRow[]> {
  const period = PERIOD_MAP[String(phase)] ?? 'เช้า'

  const { data: deficitRows } = await supabase
    .from('production_assignments')
    .select('sku, sku_name, target_quantity, deadline_time, note, table_name')
    .eq('production_date', date)
    .eq('period', period)
    .like('note', '%|deficit%')
    .in('table_name', MAIN_STATIONS)

  if (!deficitRows?.length) return []

  const skus = Array.from(new Set(deficitRows.map(a => String(a.sku))))
  const skusNorm = Array.from(new Set(skus.map(s => s.replace(/^0+/, ''))))
  const { data: bomRows } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', [...skus, ...skusNorm])

  const bomMap = new Map<string, { raw_sap: string; raw_name: string; yield_pct: number }[]>()
  for (const b of bomRows ?? []) {
    if (!b.raw_name) continue
    const norm = String(b.product_sap).replace(/^0+/, '')
    for (const key of [String(b.product_sap), norm]) {
      const list = bomMap.get(key) ?? []
      if (!list.some(x => x.raw_sap === b.raw_sap)) {
        list.push({ raw_sap: b.raw_sap ?? '', raw_name: b.raw_name, yield_pct: Number(b.yield_pct) || 1 })
        bomMap.set(key, list)
      }
    }
  }

  const rawMap = new Map<string, RawShortageRow>()

  for (const a of deficitRows) {
    const sku = String(a.sku)
    const norm = sku.replace(/^0+/, '')
    const noteTotal = parseNoteTotal(a.note)
    const qty = noteTotal > 0 ? noteTotal : Number(a.target_quantity)
    const stn = String(a.table_name)
    const time = String(a.deadline_time ?? '').slice(0, 5)
    const boms = bomMap.get(norm) ?? bomMap.get(sku) ?? []

    const addRow = (rawSku: string, rawName: string | null, rawQty: number) => {
      const key = `${stn}|||${rawSku || rawName || norm}`
      const ex = rawMap.get(key)
      if (ex) {
        ex.quantity += rawQty
        ex.deficit = (ex.deficit ?? 0) + rawQty
        if (time && (!ex.productionTime || time < ex.productionTime)) ex.productionTime = time
      } else {
        rawMap.set(key, {
          sku: rawSku || sku,
          sku_name: rawName ?? a.sku_name,
          quantity: rawQty,
          unit: 'กก.',
          deficit: rawQty,
          productionTime: time || null,
          work_station: stn,
        })
      }
    }

    if (!boms.length) {
      addRow(sku, a.sku_name, qty)
    } else {
      for (const b of boms) {
        addRow(b.raw_sap || b.raw_name, b.raw_name, b.yield_pct > 0 ? qty / b.yield_pct : qty)
      }
    }
  }

  const rawNames = Array.from(new Set(
    Array.from(rawMap.values()).map(r => r.sku_name).filter(Boolean) as string[],
  ))
  const expandedNames = Array.from(new Set(rawNames.flatMap(n => [
    n,
    n.replace(/\s*-\s*/g, '-'),
    n.replace(/\s*-\s*/g, ' - '),
  ])))

  const stockByName = new Map<string, number>()
  if (expandedNames.length > 0) {
    const [s0010, s20, s100] = await Promise.all([
      supabase.from('stock_0010').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      supabase.from('stock_20').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      supabase.from('stock_100').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
    ])
    for (const row of [...(s0010.data ?? []), ...(s20.data ?? []), ...(s100.data ?? [])]) {
      const k = normName(row.material_name ?? '')
      stockByName.set(k, (stockByName.get(k) ?? 0) + Number(row.weight_total))
    }
  }

  return Array.from(rawMap.values())
    .filter(r => {
      const available = stockByName.get(normName(r.sku_name ?? '')) ?? 0
      return available < (r.quantity - 0.005)
    })
    .map(r => ({
      ...r,
      quantity: Math.round(r.quantity * 100) / 100,
      deficit: Math.round((r.deficit ?? 0) * 100) / 100,
    }))
    .sort((a, b) => {
      const sa = MAIN_STATIONS.indexOf(a.work_station ?? '')
      const sb = MAIN_STATIONS.indexOf(b.work_station ?? '')
      if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb)
      const ta = a.productionTime ?? '99:99'
      const tb = b.productionTime ?? '99:99'
      if (ta !== tb) return ta.localeCompare(tb)
      return (a.sku_name ?? a.sku).localeCompare(b.sku_name ?? b.sku)
    })
}
