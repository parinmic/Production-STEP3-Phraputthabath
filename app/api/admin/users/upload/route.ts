import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function toMenuKey(label: string): string {
  const lower = label.trim().toLowerCase()
  if (lower === 'all') return 'all'
  if (lower.includes('เบิก'))      return 'withdrawal'
  if (lower.includes('เลื่อย'))    return 'saw_machine_plan'
  if (lower.includes('raw') || lower.includes('รอผลิต')) return 'shortage'
  if (lower.includes('ผลิต') || lower.includes('station')) return 'production'
  return label.trim()
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
    const menuKey  = toMenuKey(String(r.menu ?? ''))
    const step     = toStepKey(r.step)

    if (!posName) continue

    if (!posMap.has(posName)) posMap.set(posName, { users: new Map(), menus: new Set(), step })
    const entry = posMap.get(posName)!

    if (menuKey) entry.menus.add(menuKey)
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
