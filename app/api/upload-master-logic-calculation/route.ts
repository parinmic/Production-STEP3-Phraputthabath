import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const VALID_TYPES = [
  'mas-productivity',
  'mas-variance-makro',
  'mas-variance-wet-market',
  'mas-lotus',
  'mas-channel',
]

const TYPE_LABEL: Record<string, string> = {
  'mas-productivity':        'Mas Productivity',
  'mas-variance-makro':      'Mas %Variance Makro',
  'mas-variance-wet-market': 'Mas %Variance Wet Market',
  'mas-lotus':               'Mas LOTUS',
  'mas-channel':             'Mas Channel',
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!VALID_TYPES.includes(type)) return NextResponse.json({ uploads: [] })
  const tableName = `master_logic_calc_${type.replace(/-/g, '_')}`
  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', tableName)
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type') ?? ''
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ success: false, message: 'ประเภทไม่ถูกต้อง' }, { status: 400 })
    }
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows.map((r: Record<string, unknown>) => ({
      calculation_type: TYPE_LABEL[type],
      row_data: r,
      source_file: filename ?? 'unknown',
    }))

    const { error } = await supabase.from('master_logic_calculation').insert(records)
    if (error) throw error

    const tableName = `master_logic_calc_${type.replace(/-/g, '_')}`
    await supabase.from('upload_log').insert({
      table_name: tableName,
      source_file: filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message
      : typeof e === 'object' && e !== null && 'message' in e ? String((e as {message:unknown}).message)
      : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}
