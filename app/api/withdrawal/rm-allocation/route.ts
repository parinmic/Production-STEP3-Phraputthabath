import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { computeRmAllocation } from '@/lib/compute-rm-allocation'

export type { RmRawNeed as RawNeed, RmGroup as AllocationGroup } from '@/lib/compute-rm-allocation'

export interface RmAllocationResult {
  date: string
  summary: { raw_name: string; total_stock: number; total_allocated: number; remaining: number }[]
  allocation: import('@/lib/compute-rm-allocation').RmGroup[]
  message?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get('date')
    if (!date) return NextResponse.json({ error: 'missing date' }, { status: 400 })

    const allocation = await computeRmAllocation(date)

    if (!allocation.length) {
      return NextResponse.json({
        date, summary: [], allocation: [],
        message: `ไม่พบ WIP Plan สำหรับวันที่ ${date}`,
      })
    }

    // Build summary from all allocated items
    const summaryMap = new Map<string, { raw_name: string; total_allocated: number }>()
    for (const group of allocation) {
      for (const item of group.items) {
        const key = item.raw_name.trim().toLowerCase().replace(/\s*-\s*/g, '-')
        const cur = summaryMap.get(key) ?? { raw_name: item.raw_name, total_allocated: 0 }
        cur.total_allocated = round2(cur.total_allocated + item.allocated_kg)
        summaryMap.set(key, cur)
      }
    }

    // Fetch total stock for summary
    const rawNames = Array.from(new Set(allocation.flatMap(g => g.items.map(i => i.raw_name)).filter(Boolean)))
    const expandedNames = Array.from(new Set(rawNames.flatMap(n => [n, n.replace(/\s*-\s*/g, '-'), n.replace(/\s*-\s*/g, ' - ')])))
    let totalStockMap = new Map<string, number>()
    if (expandedNames.length) {
      const [r0010, r20] = await Promise.all([
        supabase.from('stock_0010').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
        supabase.from('stock_20').select('material_name, weight_total').in('material_name', expandedNames).gt('weight_total', 0),
      ])
      for (const r of [...(r0010.data ?? []), ...(r20.data ?? [])]) {
        if (!r.material_name) continue
        const key = r.material_name.trim().toLowerCase().replace(/\s*-\s*/g, '-')
        totalStockMap.set(key, (totalStockMap.get(key) ?? 0) + Number(r.weight_total))
      }
    }

    const summary = Array.from(summaryMap.entries()).map(([key, { raw_name, total_allocated }]) => {
      const total_stock = round2(totalStockMap.get(key) ?? 0)
      return { raw_name, total_stock, total_allocated, remaining: round2(total_stock - total_allocated) }
    }).filter(s => s.total_stock > 0).sort((a, b) => b.total_stock - a.total_stock)

    return NextResponse.json({ date, summary, allocation })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
