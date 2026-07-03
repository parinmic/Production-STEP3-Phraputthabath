import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  if (!username || !password) {
    return NextResponse.json(
      { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase.rpc('fn_login', {
    p_username: username.trim(),
    p_password: password,
  })

  if (error) {
    console.error('[login]', error)
    return NextResponse.json(
      { success: false, message: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง' },
      { status: 500 }
    )
  }

  if (!data?.success) {
    return NextResponse.json(
      { success: false, message: data?.message ?? 'เข้าสู่ระบบไม่สำเร็จ' },
      { status: 401 }
    )
  }

  const res = NextResponse.json({ success: true, user: data.user })
  res.cookies.set('step3_session', JSON.stringify(data.user), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 10, // 10 ชั่วโมง
  })
  return res
}
