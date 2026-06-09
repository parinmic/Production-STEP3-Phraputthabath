import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const VALID_TYPES = ['sa-phok-special', 'lai-special', 'sam-chan-special', 'moo-chod-special', 'slide-special']

const TYPE_LABEL: Record<string, string> = {
  'sa-phok-special':   'สะโพกพิเศษ',
  'lai-special':       'ไหล่พิเศษ',
  'sam-chan-special':   'สามชั้นพิเศษ',
  'moo-chod-special':  'หมูบดพิเศษ',
  'slide-special':     'สไลด์พิเศษ',
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ uploads: [] })
  }
  const tableName = `master_logic_manpower_${type.replace(/-/g, '_')}`
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

    const productType = TYPE_LABEL[type]
    const records = rows.map((r: Record<string, unknown>) => ({
      product_type: productType,
      row_data: r,
      source_file: filename ?? 'unknown',
    }))

    // Replace all existing rows of this product_type before inserting new ones
    const { error: delErr } = await supabase.from('master_logic_manpower')
      .delete().eq('product_type', productType)
    if (delErr) throw delErr

    const { error } = await supabase.from('master_logic_manpower').insert(records)
    if (error) throw error

    const tableName = `master_logic_manpower_${type.replace(/-/g, '_')}`
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

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    const type       = req.nextUrl.searchParams.get('type') ?? ''
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    const tableName = type ? `master_logic_manpower_${type.replace(/-/g, '_')}` : ''
    await supabase.from('master_logic_manpower').delete().eq('source_file', sourceFile)
    if (tableName) await supabase.from('upload_log').delete().eq('table_name', tableName).eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
