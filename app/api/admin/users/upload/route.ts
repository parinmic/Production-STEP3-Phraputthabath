import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { STATION_LABEL_TO_SLUG } from '@/lib/station-access'

// รูปแบบไฟล์ "User ระบบผลิต.xlsx" ชีท Main: คอลัมน์ Menu เป็นตัวเลขตามชีท Detail
// (เช่น 2.1 = คำสั่งผลิต Station สะโพกพิเศษ) หรือ "All" — 1 แถว = 1 สิทธิ์ ต่อ position
// ยังรองรับรูปแบบเก่า (ข้อความอธิบาย เช่น "คำสั่งผลิต สะโพก") ไว้เผื่ออัพโหลดฝั่งเบสิคที่ยังไม่มีเลข
function toMenuKeys(cell: string): string[] {
  const raw = cell.trim()
  if (!raw) return []
  if (raw.toLowerCase() === 'all') return ['all']

  const num = Number(raw)
  if (Number.isFinite(num)) return [String(num)]

  return toLegacyMenuKeys(raw)
}

function toLegacyMenuKeys(raw: string): string[] {
  const lower = raw.toLowerCase()
  const keys: string[] = []

  if (lower.includes('เบิก')) keys.push('withdrawal')
  else if (lower.includes('เลื่อย')) keys.push('saw_machine_plan')
  else if (lower.includes('raw') || lower.includes('รอผลิต')) keys.push('shortage')
  else if (lower.includes('ผลิต') || lower.includes('station')) keys.push('production')
  else keys.push(raw)

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

  // username เป็น unique key ของ sys_users — ถ้าไฟล์ใช้ username เดียวกันซ้ำกันคนละตำแหน่ง
  // ตำแหน่งที่ upsert ทีหลังจะแย่ง user คนนั้นไปจากตำแหน่งก่อนหน้าแบบเงียบๆ (position_id ถูกทับ)
  // เช็คก่อนอัพโหลดจริง กันข้อมูลหาย
  const usernameToPositions = new Map<string, Set<string>>()
  for (const [name, { users }] of Array.from(posMap.entries())) {
    for (const username of Array.from(users.keys())) {
      if (!usernameToPositions.has(username)) usernameToPositions.set(username, new Set())
      usernameToPositions.get(username)!.add(name)
    }
  }
  const duplicates = Array.from(usernameToPositions.entries()).filter(([, positions]) => positions.size > 1)
  if (duplicates.length > 0) {
    const detail = duplicates.map(([username, positions]) => `${username} (${Array.from(positions).join(', ')})`).join('; ')
    return NextResponse.json(
      { success: false, message: `พบ Username ซ้ำกันคนละตำแหน่ง — แต่ละ Username ต้องผูกกับตำแหน่งเดียวเท่านั้น: ${detail}` },
      { status: 400 }
    )
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
