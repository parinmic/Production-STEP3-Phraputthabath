import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export interface JobAssignWorker {
  fullName: string                    // รายชื่อพนักงาน (normalized)
  nickname: string                    // ชื่อเล่น
  firstName: string                   // ชื่อจริง (no surname)
  station: string                     // จุดงาน
  isWeigher: boolean                  // ชั่งน้ำหนัก = 1
  groups: { name: string; level: number }[]  // 1 = ดีเยี่ยม, 2 = รองลงมา
}

const normName = (s: string) => s.replace(/\s+/g, ' ').trim()

export async function GET() {
  const { data, error } = await supabase
    .from('master_logic_manpower')
    .select('product_type, row_data')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const workers: JobAssignWorker[] = []

  for (const row of data ?? []) {
    const r        = row.row_data as Record<string, unknown>
    const fullName = normName(String(r['รายชื่อพนักงาน'] ?? ''))
    if (!fullName) continue

    const nickname  = String(r['ชื่อเล่น'] ?? '').trim()
    const nameParts = fullName.split(' ')
    const firstName = nameParts[0] ?? fullName   // first word only (no surname)
    const station   = String(r['จุดงาน'] ?? '').trim()
    const isWeigher = Number(r['ชั่งน้ำหนัก'] ?? 0) === 1

    // Collect groups with skill level (1 = ดีเยี่ยม, 2 = รองลงมา)
    const groupMap = new Map<string, number>()
    for (const [key, val] of Object.entries(r)) {
      if (!key.startsWith('กลุ่ม')) continue
      if (val === null || val === undefined) continue
      const level    = Number(val)
      const cleanKey = key.replace(/_\d+$/, '')
      if (!groupMap.has(cleanKey) || level < (groupMap.get(cleanKey) ?? 99))
        groupMap.set(cleanKey, level)
    }
    const groups = Array.from(groupMap.entries()).map(([name, level]) => ({ name, level }))

    workers.push({ fullName, nickname, firstName, station, isWeigher, groups })
  }

  return NextResponse.json({ workers })
}
