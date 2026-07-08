import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { STATION_LABEL_TO_SLUG } from '@/lib/station-access'
import { hasSpecialMenu } from '@/lib/special-menu'

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
  access?: 'edit' | 'view'
}

export async function POST(req: NextRequest) {
  const raw = req.cookies.get('step3_session')?.value
  const sessionUser = raw ? JSON.parse(raw) : null
  if (!hasSpecialMenu(sessionUser?.menus, '12')) {
    return NextResponse.json({ success: false, message: 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้' }, { status: 403 })
  }

  const { rows }: { rows: RawRow[] } = await req.json()
  if (!rows?.length) {
    return NextResponse.json({ success: false, message: 'ไม่มีข้อมูลในไฟล์' }, { status: 400 })
  }

  const userMap = new Map<string, { password: string; position: string; step: string; menus: Map<string, 'edit' | 'view'> }>()
  // username เป็น unique key ของ sys_users — ถ้าไฟล์ใช้ username เดียวกันซ้ำกันคนละตำแหน่ง
  // แถวหลังๆ จะแย่ง user คนนั้นไปจากตำแหน่งของแถวแรกแบบเงียบๆ ถ้าไม่เช็ค กันข้อมูลหาย
  const positionConflicts = new Map<string, Set<string>>()

  for (const r of rows) {
    const posName  = String(r.position ?? '').trim()
    const username = String(r.username ?? '').trim()
    const password = String(r.password ?? '').trim()
    const menuKeys = toMenuKeys(String(r.menu ?? ''))
    const access   = r.access === 'view' ? 'view' : 'edit'
    const step     = toStepKey(r.step)

    if (!posName || !username) continue

    if (!userMap.has(username)) userMap.set(username, { password, position: posName, step, menus: new Map() })
    const entry = userMap.get(username)!
    if (password) entry.password = password

    if (!positionConflicts.has(username)) positionConflicts.set(username, new Set())
    positionConflicts.get(username)!.add(posName)

    // ถ้าเลขเมนูเดียวกันโผล่ซ้ำ (จากคนละแถว) และแถวไหนให้สิทธิ์ 'edit' ให้ edit ชนะ 'view' เสมอ
    for (const k of menuKeys) {
      if (!k) continue
      if (entry.menus.get(k) === 'edit') continue
      entry.menus.set(k, access)
    }
  }

  const duplicates = Array.from(positionConflicts.entries()).filter(([, positions]) => positions.size > 1)
  if (duplicates.length > 0) {
    const detail = duplicates.map(([username, positions]) => `${username} (${Array.from(positions).join(', ')})`).join('; ')
    return NextResponse.json(
      { success: false, message: `พบ Username ซ้ำกันคนละตำแหน่ง — แต่ละ Username ต้องผูกกับตำแหน่งเดียวเท่านั้น: ${detail}` },
      { status: 400 }
    )
  }

  const users = Array.from(userMap.entries()).map(([username, { password, position, step, menus }]) => ({
    username,
    password,
    position,
    step,
    menus: Array.from(menus.entries()).map(([key, access]) => ({ key, access })),
  }))

  const { data, error } = await supabase.rpc('fn_admin_bulk_upload_users', {
    p_users: users,
  })

  if (error) {
    console.error('[upload users]', error)
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
