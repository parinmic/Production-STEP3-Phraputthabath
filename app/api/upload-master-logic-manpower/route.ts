import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

const VALID_TYPES = [
  'sa-phok-special', 'lai-special', 'sam-chan-special', 'moo-chod-special', 'slide-special',
  'pao-kha-special', 'loa-kha-special',
  'sa-phok-basic', 'lai-basic', 'sam-chan-basic', 'perd-moo',
]

const TYPE_LABEL: Record<string, string> = {
  'sa-phok-special':  'สะโพกพิเศษ',
  'lai-special':      'ไหล่พิเศษ',
  'sam-chan-special':  'สามชั้นพิเศษ',
  'moo-chod-special': 'หมูบดพิเศษ',
  'slide-special':    'สไลด์พิเศษ',
  'pao-kha-special':  'เผาขาพิเศษ',
  'loa-kha-special':  'เลาะขาพิเศษ',
  'sa-phok-basic':    'สะโพกเบสิค',
  'lai-basic':        'ไหล่เบสิค',
  'sam-chan-basic':    'สามชั้นเบสิค',
  'perd-moo':         'เปิดหมู',
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ uploads: [] })
  }
  const tableName = `master_logic_manpower_${type.replace(/-/g, '_')}`
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
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

    const tableName = `master_logic_manpower_${type.replace(/-/g, '_')}`
    const { data: logEntry, error: logErr } = await supabase
      .from('upload_log')
      .insert({ table_name: tableName, source_file: filename ?? 'unknown', record_count: records.length })
      .select('id')
      .single()
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: logEntry.id }))
    const { error } = await supabase.from('master_logic_manpower').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', logEntry.id)
      throw error
    }

    await syncToDevAwaited(async (dev) => {
      const { data: devLog, error: devLogErr } = await dev
        .from('upload_log')
        .insert({ table_name: tableName, source_file: filename ?? 'unknown', record_count: records.length })
        .select('id')
        .single()
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'master_logic_manpower', records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: devLog.id })))
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
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes master_logic_manpower rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
