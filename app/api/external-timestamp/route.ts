import { NextResponse } from 'next/server'
import { externalSupabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await externalSupabase
    .from('timestamp_with_dept')
    .select('*')
    .limit(1000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
