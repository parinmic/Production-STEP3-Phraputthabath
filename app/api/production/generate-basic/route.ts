import { NextRequest, NextResponse } from 'next/server'
import { generateBasicPlan } from '@/lib/generate-plan-basic'
import { supabase } from '@/lib/supabase'

const BASIC_STATIONS = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']

function phaseDeadline(result: { startTime?: string; endTime?: string | null }) {
  return result.endTime ?? result.startTime ?? null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await generateBasicPlan(body)
    if (!result.success) {
      return NextResponse.json(result, { status: 400 })
    }

    const skuTargets = result.skuTargets ?? []
    const productionDate = body.date ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const effectiveFrom = new Date().toISOString()
    const assignments = skuTargets
      .filter(t => t.station && Number(t.quantityKg ?? 0) > 0)
      .map((t, idx) => ({
        production_date: productionDate,
        table_name: t.station,
        worker_code: '-',
        worker_name: 'Auto Basic',
        sku: t.sku,
        sku_name: t.skuName,
        target_quantity: Math.round(Number(t.quantityKg) * 100) / 100,
        unit: 'กก.',
        period: result.period,
        deadline_time: phaseDeadline(result),
        status: 'รอดำเนินการ',
        channel: t.channel,
        note: [
          `basic-phase${result.phase}`,
          t.productGroup ? `group:${t.productGroup}` : null,
          t.allocationStatus ? `allocation:${t.allocationStatus}` : null,
          Number(t.shortageKg ?? 0) > 0 ? `shortage:${Math.round(Number(t.shortageKg) * 100) / 100}` : null,
        ].filter(Boolean).join('|'),
        seq: idx,
        effective_from: effectiveFrom,
      }))

    if (!assignments.length) {
      return NextResponse.json({ ...result, success: false, message: 'ไม่พบรายการ SKU ที่สร้างเป็นแผนได้' }, { status: 400 })
    }

    const stations = Array.from(new Set(assignments.map(a => a.table_name)))
    const { error: deleteError } = await supabase
      .from('production_assignments')
      .delete()
      .eq('production_date', productionDate)
      .eq('period', result.period)
      .in('table_name', BASIC_STATIONS)

    if (deleteError) throw deleteError

    const { error: insertError } = await supabase
      .from('production_assignments')
      .insert(assignments)

    if (insertError) throw insertError

    const response = {
      ...result,
      message: `สร้าง Phase ${result.phase} สำเร็จ ${assignments.length} รายการ / ${stations.length} station`,
      count: assignments.length,
      stations,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (e: unknown) {
    const msg = e instanceof Error
      ? e.message
      : (typeof e === 'object' && e !== null)
        ? ((e as any).message ?? (e as any).details ?? JSON.stringify(e))
        : String(e)
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}
