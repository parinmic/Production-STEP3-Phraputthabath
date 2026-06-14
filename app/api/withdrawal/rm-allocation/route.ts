import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { computeRmAllocation } from '@/lib/compute-rm-allocation'

export type { RmRawNeed as RawNeed, RmGroup as AllocationGroup } from '@/lib/compute-rm-allocation'

export interface WipNeedItem {
  raw_sap:     string
  raw_name:    string | null
  needed_kg:   number
  for_products: { sku: string; sku_name: string | null; qty: number }[]
}

export interface WipPhaseNeeds {
  phase:  number
  period: string
  items:  WipNeedItem[]
}

export interface RmAllocationResult {
  date: string
  summary: { raw_name: string; total_stock: number; total_allocated: number; remaining: number }[]
  allocation: import('@/lib/compute-rm-allocation').RmGroup[]
  wipNeeds?: WipPhaseNeeds[]
  message?: string
}

const round2   = (n: number) => Math.round(n * 100) / 100
const normName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

/** Compute WIP(F) items that สไลด์ needs to produce in-house (not from warehouse stock) */
async function computeSlideWipNeeds(date: string): Promise<WipPhaseNeeds[]> {
  const PERIODS = [
    { phase: 1, period: 'เช้า' },
    { phase: 2, period: 'บ่าย' },
    { phase: 3, period: 'ค่ำ' },
  ]

  // 1. Fetch สไลด์ assignments for all phases
  const { data: assignments } = await supabase
    .from('production_assignments')
    .select('sku, sku_name, target_quantity, period')
    .eq('production_date', date)
    .eq('table_name', 'สไลด์')
    .in('period', ['เช้า', 'บ่าย', 'ค่ำ'])

  if (!assignments?.length) return []

  // 2. Fetch BOM for all assigned SKUs
  const skus = Array.from(new Set(assignments.map(a => a.sku)))
  const { data: bomRows } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', skus)

  if (!bomRows?.length) return []

  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
  for (const b of bomRows) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
    bomMap.set(b.product_sap, list)
  }

  // 3. Check which raw SAP codes exist in stock (any weight)
  const allRawSaps  = Array.from(new Set(bomRows.map(b => b.raw_sap).filter(Boolean) as string[]))
  const stockSapSet = new Set<string>()

  if (allRawSaps.length) {
    const [r0010, r20] = await Promise.all([
      supabase.from('stock_0010').select('material_code').in('material_code', allRawSaps).limit(500),
      supabase.from('stock_20').select('material_code').in('material_code', allRawSaps).limit(500),
    ])
    for (const r of [...(r0010.data ?? []), ...(r20.data ?? [])]) {
      if (r.material_code) stockSapSet.add(String(r.material_code).trim())
    }
  }

  // 4. Per phase: aggregate WIP needs (BOM components NOT in stock system)
  const result: WipPhaseNeeds[] = []

  for (const { phase, period } of PERIODS) {
    const phaseAss = assignments.filter(a => a.period === period)
    if (!phaseAss.length) continue

    const rawNeeds = new Map<string, WipNeedItem>()

    for (const a of phaseAss) {
      const boms = bomMap.get(a.sku) ?? []
      for (const b of boms) {
        if (stockSapSet.has(b.raw_sap.trim())) continue  // in warehouse stock — skip
        const needed = b.yield_pct > 0 ? Number(a.target_quantity) / b.yield_pct : Number(a.target_quantity)
        const cur = rawNeeds.get(b.raw_sap) ?? { raw_sap: b.raw_sap, raw_name: b.raw_name, needed_kg: 0, for_products: [] }
        cur.needed_kg += needed
        cur.for_products.push({ sku: a.sku, sku_name: a.sku_name ?? null, qty: Number(a.target_quantity) })
        rawNeeds.set(b.raw_sap, cur)
      }
    }

    if (rawNeeds.size) {
      result.push({
        phase,
        period,
        items: Array.from(rawNeeds.values()).map(r => ({ ...r, needed_kg: round2(r.needed_kg) })),
      })
    }
  }

  return result
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

    const [allocation, wipNeeds] = await Promise.all([
      computeRmAllocation(date),
      computeSlideWipNeeds(date),
    ])

    if (!allocation.length) {
      return NextResponse.json({
        date, summary: [], allocation: [], wipNeeds: [],
        message: `ไม่พบ WIP Plan สำหรับวันที่ ${date}`,
      })
    }

    // Build summary from all allocated items
    const summaryMap = new Map<string, { raw_name: string; total_allocated: number }>()
    for (const group of allocation) {
      for (const item of group.items) {
        const key = normName(item.raw_name)
        const cur = summaryMap.get(key) ?? { raw_name: item.raw_name, total_allocated: 0 }
        cur.total_allocated = round2(cur.total_allocated + item.allocated_kg)
        summaryMap.set(key, cur)
      }
    }

    // Fetch total stock for summary
    const rawNames = Array.from(new Set(allocation.flatMap(g => g.items.map(i => i.raw_name)).filter(Boolean)))
    const expandedNames = Array.from(new Set(rawNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
    const totalStockMap = new Map<string, number>()
    if (expandedNames.length) {
      const [r0010, r20] = await Promise.all([
        supabase.from('stock_0010').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      ])
      for (const r of [...(r0010.data ?? []), ...(r20.data ?? [])]) {
        if (!r.material_name) continue
        const key = normName(r.material_name)
        totalStockMap.set(key, (totalStockMap.get(key) ?? 0) + Number(r.weight_total))
      }
    }

    const summary = Array.from(summaryMap.entries()).map(([key, { raw_name, total_allocated }]) => {
      const total_stock = round2(totalStockMap.get(key) ?? 0)
      return { raw_name, total_stock, total_allocated, remaining: round2(total_stock - total_allocated) }
    }).filter(s => s.total_stock > 0).sort((a, b) => b.total_stock - a.total_stock)

    return NextResponse.json({ date, summary, allocation, wipNeeds })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
