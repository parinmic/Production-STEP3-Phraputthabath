import { NextResponse } from 'next/server'

export async function POST() {
  const user = {
    id: 'admin',
    username: 'Admin',
    position: 'ผู้ดูแลระบบ',
    menus: ['all'],
    step: 'all',
  }

  const res = NextResponse.json({ success: true, user })
  res.cookies.set('step3_session', JSON.stringify(user), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60, // 1 ชั่วโมง
  })
  return res
}
