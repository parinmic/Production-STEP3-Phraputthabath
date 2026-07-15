import { NextRequest, NextResponse } from 'next/server'
import {
  generateBasicPlan,
  BASIC_PHASES,
  fetchDynamicBreakWindows,
  fetchBasicPickingUnitMaps,
  addMinsSkippingBreaks,
  timeStrToMins,
  minsToTimeStr,
  normalizeSku,
  type BasicBreakWindow,
  type BasicSkuTarget,
  type BasicPhase,
} from '@/lib/generate-plan-basic'
import { supabase } from '@/lib/supabase'
import { todayBangkok } from '@/lib/date'

const BASIC_STATIONS = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']
const RAW_QUEUE_BUFFER_MINS = 15

function phaseDeadline(result: { startTime?: string; endTime?: string | null }) {
  return result.endTime ?? result.startTime ?? null
}

type RawQueueSchedule = { finish: string; status: 'on_time' | 'buffer_missed' | 'late' | 'unknown' }

// Raw-queue items already win top priority for the shared yield pool (see generateBasicPlan); here
// they also get scheduled first within their own station — sorted by need-time and chained
// back-to-back from phase start, skipping breaks. A SKU whose basket time is unknown (resolved only
// via mas_raw_basket's kg_per_basket, which has no mins_per_basket) can't be timed, so it's tagged
// 'unknown' and doesn't advance the cursor for the rest of the station's queue.
function scheduleRawQueue(
  targets: BasicSkuTarget[],
  phaseStartMins: number,
  breaks: BasicBreakWindow[],
  pickingUnitMaps: { bagMap: Record<string, number>; minsMap: Record<string, number> },
): Map<number, RawQueueSchedule> {
  const schedule = new Map<number, RawQueueSchedule>()
  const byStation = new Map<string, number[]>()
  targets.forEach((t, idx) => {
    const list = byStation.get(t.station ?? '') ?? []
    list.push(idx)
    byStation.set(t.station ?? '', list)
  })

  for (const indices of Array.from(byStation.values())) {
    const sorted = indices
      .slice()
      .sort((a: number, b: number) => (targets[a].neededByTime ?? '99:99').localeCompare(targets[b].neededByTime ?? '99:99'))
    let cursor = phaseStartMins
    for (const idx of sorted) {
      const t = targets[idx]
      if (!t.neededByTime) continue
      const needMins = timeStrToMins(t.neededByTime)
      const norm = normalizeSku(t.sku)
      const wpb = pickingUnitMaps.bagMap[t.sku] ?? pickingUnitMaps.bagMap[norm] ?? 0
      const mpb = pickingUnitMaps.minsMap[t.sku] ?? pickingUnitMaps.minsMap[norm] ?? 0

      if (wpb > 0 && mpb > 0) {
        const durationMins = Math.ceil(t.quantityKg / wpb) * mpb
        cursor = addMinsSkippingBreaks(cursor, durationMins, breaks)
        const status: RawQueueSchedule['status'] =
          cursor <= needMins - RAW_QUEUE_BUFFER_MINS ? 'on_time' :
          cursor <= needMins ? 'buffer_missed' : 'late'
        schedule.set(idx, { finish: minsToTimeStr(cursor), status })
      } else {
        schedule.set(idx, { finish: minsToTimeStr(needMins - RAW_QUEUE_BUFFER_MINS), status: 'unknown' })
      }
    }
  }

  return schedule
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await generateBasicPlan(body)
    if (!result.success) {
      return NextResponse.json(result, { status: 400 })
    }

    const skuTargets = result.skuTargets ?? []
    const productionDate = body.date ?? todayBangkok()
    const effectiveFrom = new Date().toISOString()

    const plannedTargets = skuTargets.filter(t => t.station && Number(t.quantityKg ?? 0) > 0)
    const orderedTargets = plannedTargets
      .map((target, originalIndex) => ({ target, originalIndex }))
      .sort((a, b) => {
        const aRaw = a.target.channel === 'Raw Queue'
        const bRaw = b.target.channel === 'Raw Queue'
        if (aRaw !== bRaw) return aRaw ? -1 : 1
        if (aRaw && bRaw) {
          const stationOrder = (a.target.station ?? '').localeCompare(b.target.station ?? '')
          if (stationOrder !== 0) return stationOrder
          const needOrder = (a.target.neededByTime ?? '99:99').localeCompare(b.target.neededByTime ?? '99:99')
          if (needOrder !== 0) return needOrder
        }
        return a.originalIndex - b.originalIndex
      })
      .map(row => row.target)
    const phaseCfg = BASIC_PHASES[result.phase as BasicPhase]

    let rawQueueSchedule = new Map<number, RawQueueSchedule>()
    if (orderedTargets.some(t => t.channel === 'Raw Queue')) {
      const [dynamicBreaks, pickingUnitMaps] = await Promise.all([
        fetchDynamicBreakWindows(productionDate),
        fetchBasicPickingUnitMaps(),
      ])
      rawQueueSchedule = scheduleRawQueue(
        orderedTargets,
        phaseCfg.startMins,
        [...phaseCfg.breaks, ...dynamicBreaks],
        pickingUnitMaps,
      )
    }

    const assignments = orderedTargets.map((t, idx) => {
      const isRawQueue = t.channel === 'Raw Queue'
      const rawSchedule = rawQueueSchedule.get(idx)

      const deadlineTime = isRawQueue
        ? (rawSchedule ? rawSchedule.finish + ':00' : phaseDeadline(result))
        : phaseDeadline(result)

      const note = isRawQueue
        ? `raw-queue|phase${result.phase}|finish=${rawSchedule?.finish ?? ''}|status=${rawSchedule?.status ?? 'unknown'}|need=${t.neededByTime ?? ''}`
        : [
            `basic-phase${result.phase}`,
            t.productGroup ? `group:${t.productGroup}` : null,
            t.allocationStatus ? `allocation:${t.allocationStatus}` : null,
            Number(t.shortageKg ?? 0) > 0 ? `shortage:${Math.round(Number(t.shortageKg) * 100) / 100}` : null,
            ...(t.auditReasons ?? []).map(reason => `reason:${reason}`),
          ].filter(Boolean).join('|')

      return {
        production_date: productionDate,
        table_name: t.station,
        worker_code: '-',
        worker_name: 'Auto Basic',
        sku: t.sku,
        sku_name: t.skuName,
        target_quantity: Math.round(Number(t.quantityKg) * 100) / 100,
        unit: 'กก.',
        period: result.period,
        deadline_time: deadlineTime,
        status: 'รอดำเนินการ',
        channel: t.channel,
        note,
        seq: idx,
        effective_from: effectiveFrom,
      }
    })

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
