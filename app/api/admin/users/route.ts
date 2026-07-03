import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const [{ data: users, error: uErr }, { data: positions, error: pErr }] = await Promise.all([
    supabase.rpc('fn_admin_list_users'),
    supabase.rpc('fn_admin_list_positions'),
  ])
  if (uErr || pErr) {
    return NextResponse.json({ error: uErr?.message ?? pErr?.message }, { status: 500 })
  }
  return NextResponse.json({ users: users ?? [], positions: positions ?? [] })
}

export async function POST(req: NextRequest) {
  const { username, password, position_id } = await req.json()
  const { data, error } = await supabase.rpc('fn_admin_create_user', {
    p_username: username,
    p_password: password,
    p_position_id: position_id,
  })
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, password, is_active, position_id } = await req.json()
  const { data, error } = await supabase.rpc('fn_admin_update_user', {
    p_id: id,
    p_password: password ?? null,
    p_is_active: is_active ?? null,
    p_position_id: position_id ?? null,
  })
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const { data, error } = await supabase.rpc('fn_admin_delete_user', { p_id: id })
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json(data)
}
