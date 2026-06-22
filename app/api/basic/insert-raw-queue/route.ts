import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const STATION_MAP: Record<string, string> = {
  'สามชั้น': 'สามชั้นเบสิค',
  'สะโพก':   'สะโพกเบสิค',
  'ไหล่':    'ไหล่เบสิค',
}

const PERIOD_MAP: Record<string, string> = {
  '1': 'เช้า',
  '2': 'บ่าย',
  '3': 'ค่ำ',
}

function addMins(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + mins
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60)
  const mm = ((total % 60) + 60) % 60
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}

interface QueueItem {
  sku: string
  sku_name: string | null
  deficit: number | null
  productionTime: string | null
  work_station: string | null
  baskets: number | null
  mins: number | null
}

export async function POST(req: NextRequest) {
  try {
    const { date, phase, items } = await req.json() as {
      date: string
      phase: string
      items: QueueItem[]
    }
    if (!date || !phase || !items?.length) {
      return NextResponse.json({ success: false, message: 'ข้อมูลไม่ครบ' }, { status: 400 })
    }

    const period = PERIOD_MAP[phase] ?? 'เช้า'

    // Group by work_station
    const byStation = new Map<string, QueueItem[]>()
    for (const item of items) {
      const stn = item.work_station
      if (!stn || !STATION_MAP[stn] || !item.mins) continue
      const list = byStation.get(stn) ?? []
      list.push(item)
      byStation.set(stn, list)
    }

    if (!byStation.size) {
      return NextResponse.json({ success: false, message: 'ไม่มีสถานีที่รองรับ หรือไม่มีข้อมูล นาที/ตะกร้า' })
    }

    const assignments = []

    for (const [stn, stItems] of byStation) {
      const basicTable = STATION_MAP[stn]

      // Sort by deadline ascending (earliest deadline first)
      const sorted = [...stItems].sort((a, b) =>
        (a.productionTime ?? '99:99').localeCompare(b.productionTime ?? '99:99')
      )

      // Cutoff = earliest deadline - 20 min
      const minDeadline = sorted[0].productionTime ?? '23:59'
      const cutoff = addMins(minDeadline, -20)

      // Total production time needed
      const totalMins = sorted.reduce((s, it) => s + (it.mins ?? 0), 0)

      // Start scheduling from (cutoff - totalMins) going forward
      let cursor = addMins(cutoff, -totalMins)

      for (const item of sorted) {
        const finishTime = addMins(cursor, item.mins ?? 0)
        assignments.push({
          production_date: date,
          table_name:      basicTable,
          worker_code:     '-',
          worker_name:     '-',
          sku:             item.sku,
          sku_name:        item.sku_name ?? null,
          target_quantity: item.baskets ?? 0,
          unit:            'ตะกร้า',
          period,
          channel:         null,
          status:          'รอดำเนินการ',
          deadline_time:   finishTime + ':00',
          note:            `raw-queue|phase${phase}`,
        })
        cursor = finishTime
      }
    }

    if (!assignments.length) {
      return NextResponse.json({ success: false, message: 'ไม่มีรายการที่แทรกได้' })
    }

    const { error } = await supabase.from('production_assignments').insert(assignments)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, message: `แทรกคิวสำเร็จ ${assignments.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}
