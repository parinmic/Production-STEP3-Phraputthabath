import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { STATION_LABEL_TO_SLUG } from '@/lib/station-access'

// คืนค่าเป็นหลาย key ได้: 1 หมวดหลัก (all/withdrawal/saw_machine_plan/shortage/production)
// บวกกับ station:<slug> ถ้าข้อความใน Menu ระบุชื่อ station ไว้ด้วย (เช่น "คำสั่งผลิต สะโพก"
// จะได้ทั้ง production และ station:sa-phok — จำกัดให้เห็น/เข้าได้เฉพาะ station นั้น)
function toMenuKeys(label: string): string[] {
  const raw = label.trim()
  const lower = raw.toLowerCase()
  const keys: string[] = []

  if (lower === 'all') keys.push('all')
  else if (lower.includes('เบิก')) keys.push('withdrawal')
  else if (lower.includes('เลื่อย')) keys.push('saw_machine_plan')
  else if (lower.includes('raw') || lower.includes('รอผลิต')) keys.push('shortage')
  else if (lower.includes('ผลิต') || lower.includes('station')) keys.push('production')
  else if (raw) keys.push(raw)

  for (const [stationLabel, slug] of Object.entries(STATION_LABEL_TO_SLUG)) {
    if (raw.includes(stationLabel)) keys.push(`station:${slug}`)
  }

  return keys
}

function toStepKey(raw: string | number | null | undefined): string {
  const s = String(raw ?? '').trim().toLowerCase()
  if (s === 'all') return 'all'
  if (s === '2') return '2'
  return '3'
}

interface RawRow {
  position: string
  username: string
  password: string
  step: string | number
  menu: string
}

export async function POST(req: NextRequest) {
  const { rows }: { rows: RawRow[] } = await req.json()
  if (!rows?.length) {
    return NextResponse.json({ success: false, message: 'ไม่มีข้อมูลในไฟล์' }, { status: 400 })
  }

  const posMap = new Map<string, { users: Map<string, string>; menus: Set<string>; step: string }>()

  for (const r of rows) {
    const posName  = String(r.position ?? '').trim()
    const username = String(r.username ?? '').trim()
    const password = String(r.password ?? '').trim()
    const menuKeys = toMenuKeys(String(r.menu ?? ''))
    const step     = toStepKey(r.step)

    if (!posName) continue

    if (!posMap.has(posName)) posMap.set(posName, { users: new Map(), menus: new Set(), step })
    const entry = posMap.get(posName)!

    for (const k of menuKeys) if (k) entry.menus.add(k)
    if (username) entry.users.set(username, password)
  }

  const positions = Array.from(posMap.entries()).map(([name, { users, menus, step }]) => ({
    name,
    step,
    menus: Array.from(menus),
    users: Array.from(users.entries()).map(([username, password]) => ({ username, password })),
  }))

  const { data, error } = await supabase.rpc('fn_admin_bulk_upload_users', {
    p_positions: positions,
  })

  if (error) {
    console.error('[upload users]', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
