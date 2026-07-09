import { NextRequest, NextResponse } from 'next/server'
import { supabase, latestStockLogId } from '@/lib/supabase'
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
  /** min(allocated/needed) per phase for สไลด์ station — used by Gantt to split bars */
  wipCapFractionByPhase?: Record<number, number>
  message?: string
}

const round2   = (n: number) => Math.round(n * 100) / 100
const normName = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

/**
 * Compute:
 * 1. WIP(F) items สไลด์ produces in-house (BOM components not in warehouse stock)
 * 2. Cap fraction per phase: min(rm_allocated / full_production_needed)
 *    Used by the Gantt to split bars when rm-allocation crisis/extra < full plan
 */
async function computeSlideNeeds(
  date: string,
  allocation: import('@/lib/compute-rm-allocation').RmGroup[]
): Promise<{ wipNeeds: WipPhaseNeeds[]; wipCapFractionByPhase: Record<number, number> }> {
  const PERIODS = [
    { phase: 1, period: 'เช้า' },
    { phase: 2, period: 'บ่าย' },
    { phase: 3, period: 'ค่ำ' },
  ]
  const PERIOD_PHASE: Record<string, number> = { 'เช้า': 1, 'บ่าย': 2, 'ค่ำ': 3 }

  // 1. Fetch สไลด์ assignments for all phases
  const { data: assignments } = await supabase
    .from('production_assignments')
    .select('sku, sku_name, target_quantity, period')
    .eq('production_date', date)
    .eq('table_name', 'สไลด์')
    .in('period', ['เช้า', 'บ่าย', 'ค่ำ'])

  if (!assignments?.length) return { wipNeeds: [], wipCapFractionByPhase: {} }

  // 2. Fetch BOM for all assigned SKUs
  const skus = Array.from(new Set(assignments.map(a => a.sku)))
  const { data: bomRows } = await supabase
    .from('bom_items')
    .select('product_sap, raw_sap, raw_name, yield_pct')
    .in('product_sap', skus)

  if (!bomRows?.length) return { wipNeeds: [], wipCapFractionByPhase: {} }

  const bomMap = new Map<string, { raw_sap: string; raw_name: string | null; yield_pct: number }[]>()
  for (const b of bomRows) {
    if (!b.raw_sap) continue
    const list = bomMap.get(b.product_sap) ?? []
    list.push({ raw_sap: b.raw_sap, raw_name: b.raw_name ?? null, yield_pct: b.yield_pct ?? 0 })
    bomMap.set(b.product_sap, list)
  }

  // 3. Check which raw components exist in stock — WIP items won't be found
  // Check by both SAP code and material name to avoid misclassification when SAP codes differ.
  const allRawSaps  = Array.from(new Set(bomRows.map(b => b.raw_sap).filter(Boolean) as string[]))
  const allRawNames = Array.from(new Set(bomRows.map(b => b.raw_name).filter(Boolean) as string[]))
  const expandedRawNames = Array.from(new Set(allRawNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
  const stockSapSet  = new Set<string>()
  const stockNameSet = new Set<string>()

  const [slideId0010, slideId20] = await Promise.all([latestStockLogId('stock_0010'), latestStockLogId('stock_20')])

  const stockProms: Promise<{ data: { material_code?: string | null; material_name?: string | null }[] | null }>[] = []
  if (allRawSaps.length) {
    stockProms.push(
      supabase.from('stock_0010').select('material_code').eq('upload_log_id', slideId0010).in('material_code', allRawSaps).limit(500) as Promise<{ data: { material_code?: string | null }[] | null }>,
      supabase.from('stock_20').select('material_code').eq('upload_log_id', slideId20).in('material_code', allRawSaps).limit(500) as Promise<{ data: { material_code?: string | null }[] | null }>,
    )
  }
  if (expandedRawNames.length) {
    stockProms.push(
      supabase.from('stock_0010').select('material_name').eq('upload_log_id', slideId0010).in('material_name', expandedRawNames).gt('weight_total', 0).limit(500) as Promise<{ data: { material_name?: string | null }[] | null }>,
      supabase.from('stock_20').select('material_name').eq('upload_log_id', slideId20).in('material_name', expandedRawNames).gt('weight_total', 0).limit(500) as Promise<{ data: { material_name?: string | null }[] | null }>,
    )
  }
  if (stockProms.length) {
    const results = await Promise.all(stockProms)
    for (const res of results) {
      for (const r of res.data ?? []) {
        if (r.material_code) stockSapSet.add(String(r.material_code).trim())
        if (r.material_name) stockNameSet.add(normName(String(r.material_name).trim()))
      }
    }
  }

  // 4. Per phase: build WIP needs (components NOT in stock) + full raw needed (ALL components)
  const wipNeeds: WipPhaseNeeds[] = []
  const fullNeeded = new Map<number, Map<string, number>>() // phase → normName → total needed kg

  for (const { phase, period } of PERIODS) {
    const phaseAss = assignments.filter(a => a.period === period)
    if (!phaseAss.length) continue

    const wipItems = new Map<string, WipNeedItem>()

    for (const a of phaseAss) {
      const boms = bomMap.get(a.sku) ?? []
      for (const b of boms) {
        const needed = b.yield_pct > 0 ? Number(a.target_quantity) / b.yield_pct : Number(a.target_quantity)

        if (stockSapSet.has(b.raw_sap.trim()) || stockNameSet.has(normName(b.raw_name ?? ''))) {
          // Cap fraction: only warehouse-stocked components (WIP components have no alloc so skip)
          const normN  = normName(b.raw_name ?? b.raw_sap)
          const byRaw  = fullNeeded.get(phase) ?? new Map()
          byRaw.set(normN, (byRaw.get(normN) ?? 0) + needed)
          fullNeeded.set(phase, byRaw)
        } else {
          // WIP display: components NOT found in warehouse stock
          const cur = wipItems.get(b.raw_sap) ?? { raw_sap: b.raw_sap, raw_name: b.raw_name, needed_kg: 0, for_products: [] }
          cur.needed_kg += needed
          cur.for_products.push({ sku: a.sku, sku_name: a.sku_name ?? null, qty: Number(a.target_quantity) })
          wipItems.set(b.raw_sap, cur)
        }
      }
    }

    if (wipItems.size) {
      wipNeeds.push({
        phase,
        period,
        items: Array.from(wipItems.values()).map(r => ({ ...r, needed_kg: round2(r.needed_kg) })),
      })
    }
  }

  // 5. Cap fraction: compare total rm-allocated vs full production raw needed, per phase
  const totalAlloc = new Map<number, Map<string, number>>() // phase → normName → allocated
  for (const g of allocation) {
    if (g.station !== 'สไลด์') continue
    for (const item of g.items) {
      const normN  = normName(item.raw_name)
      const byRaw  = totalAlloc.get(g.phase) ?? new Map()
      byRaw.set(normN, (byRaw.get(normN) ?? 0) + item.allocated_kg)
      totalAlloc.set(g.phase, byRaw)
    }
  }

  const wipCapFractionByPhase: Record<number, number> = {}
  for (const [ph, rawNeeds] of Array.from(fullNeeded.entries())) {
    const allocByRaw = totalAlloc.get(ph)
    let minFrac = 1.0
    for (const [normN, needed] of Array.from(rawNeeds.entries())) {
      if (needed < 0.005) continue
      const alloc = allocByRaw?.get(normN) ?? 0
      minFrac = Math.min(minFrac, alloc / needed)
    }
    if (minFrac < 0.999) wipCapFractionByPhase[ph] = round2(minFrac)
  }

  return { wipNeeds, wipCapFractionByPhase }
}

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

    const allocation = await computeRmAllocation(date)
    const { wipNeeds, wipCapFractionByPhase } = await computeSlideNeeds(date, allocation)

    if (!allocation.length) {
      return NextResponse.json({
        date, summary: [], allocation: [], wipNeeds: [], wipCapFractionByPhase: {},
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
      const [sumId0010, sumId20] = await Promise.all([latestStockLogId('stock_0010'), latestStockLogId('stock_20')])
      const [r0010, r20] = await Promise.all([
        supabase.from('stock_0010').select('material_name, weight_total').eq('upload_log_id', sumId0010).in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_name, weight_total').eq('upload_log_id', sumId20).in('material_name', expandedNames).gt('weight_total', 0),
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

    return NextResponse.json({ date, summary, allocation, wipNeeds, wipCapFractionByPhase })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
