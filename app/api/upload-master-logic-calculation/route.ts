import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

const VALID_TYPES = [
  // Special
  'mas-productivity',
  'mas-variance-makro',
  'mas-variance-wet-market',
  'mas-variance-lotus',
  'mas-lotus',
  'mas-channel',
  'mas-trakra',
  'mas-special',
  'mas-sku-concurrent',
  'mas-raw-material',
  'mas-makro-branch',
  // Basic
  'mas-productivity-basic',
  'mas-variance-makro-basic',
  'mas-variance-wet-market-basic',
  'mas-variance-lotus-basic',
  'mas-channel-basic',
  'mas-special-basic',
  'mas-saipan',
  'mas-raw-basket',
]

const TYPE_LABEL: Record<string, string> = {
  'mas-productivity':                'Mas Productivity',
  'mas-variance-makro':              'Mas %Variance Makro',
  'mas-variance-wet-market':         'Mas %Variance Wet Market',
  'mas-variance-lotus':              'Mas %Variance LOTUS',
  'mas-lotus':                       'Mas LOTUS',
  'mas-channel':                     'Mas Channel',
  'mas-trakra':                      'Mas ตระกร้า',
  'mas-special':                     'Mas Special',
  'mas-sku-concurrent':              'Mas Sku ผลิตพร้อมกัน',
  'mas-raw-material':                'Mas Raw Material',
  'mas-makro-branch':                'Mas Makro สาขา',
  'mas-productivity-basic':          'Mas Productivity Basic',
  'mas-variance-makro-basic':        'Mas %Variance Makro Basic',
  'mas-variance-wet-market-basic':   'Mas %Variance Wet Market Basic',
  'mas-variance-lotus-basic':        'Mas %Variance LOTUS Basic',
  'mas-channel-basic':               'Mas Channel Basic',
  'mas-special-basic':               'Mas Special Basic',
  'mas-saipan':                      'Mas สายพาน',
  'mas-raw-basket':                  'Mas ตะกร้า Raw',
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!VALID_TYPES.includes(type)) return NextResponse.json({ uploads: [] })
  const tableName = `master_logic_calc_${type.replace(/-/g, '_')}`
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

    const records = rows.map((r: Record<string, unknown>) => ({
      calculation_type: TYPE_LABEL[type],
      row_data: r,
      source_file: filename ?? 'unknown',
    }))

    const tableName = `master_logic_calc_${type.replace(/-/g, '_')}`
    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: tableName, source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('master_logic_calculation').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncToDevAwaited(async (dev) => {
      const devLogId = crypto.randomUUID()
      const { error: devLogErr } = await dev
        .from('upload_log')
        .insert({ id: devLogId, table_name: tableName, source_file: filename ?? 'unknown', record_count: records.length })
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'master_logic_calculation', records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: devLogId })))
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
    // ON DELETE CASCADE removes master_logic_calculation rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
