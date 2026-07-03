import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { step } = await req.json()

  const user = {
    id: 'admin',
    username: 'Admin',
    position: 'ผู้ดูแลระบบ',
    menus: ['all'],
    step: 'all',
  }

  const redirectTo = step === 2 ? '/basic' : '/home'

  const res = NextResponse.json({ success: true, redirectTo })
  res.cookies.set('step3_session', JSON.stringify(user), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 10,
  })
  return res
}
