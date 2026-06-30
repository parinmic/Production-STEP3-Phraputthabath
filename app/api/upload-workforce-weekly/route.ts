import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

const VALID_TYPES = [
  'sa-phok-special', 'lai-special', 'sam-chan-special', 'moo-chod-special', 'slide-special',
  'pao-kha-special', 'loa-kha-special',
  'sa-phok-basic', 'lai-basic', 'sam-chan-basic', 'perd-moo',
]

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ success: false, message: 'ประเภทไม่ถูกต้อง' }, { status: 400 })
  }

  const sourceFile = req.nextUrl.searchParams.get('file')
  const latest = req.nextUrl.searchParams.get('latest') === 'true'
  const logTableName = `workforce_weekly_${type.replace(/-/g, '_')}`

  // latest mode: find the most recent file upload and return its rows
  if (latest) {
    const { data: latestLog, error: logError } = await supabase
      .from('upload_log')
      .select('source_file')
      .eq('table_name', logTableName)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (logError) return NextResponse.json({ error: logError.message }, { status: 500 })
    if (!latestLog) return NextResponse.json({ data: [] })

    const { data, error } = await supabase
      .from('workforce_weekly')
      .select('row_data')
      .eq('weekly_type', type)
      .eq('source_file', latestLog.source_file)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
  }

  // download mode: return full row_data for a specific file and type
  if (sourceFile) {
    const { data, error } = await supabase
      .from('workforce_weekly')
      .select('row_data')
      .eq('weekly_type', type)
      .eq('source_file', sourceFile)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
  }

  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', logTableName)
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
      weekly_type: type,
      source_file: filename ?? 'unknown',
      row_data:    r,
    })).filter((r: { row_data: Record<string, unknown> }) => Object.values(r.row_data).some(v => v !== null && v !== ''))

    if (!records.length)
      return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    const logTableName = `workforce_weekly_${type.replace(/-/g, '_')}`
    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: logTableName, source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('workforce_weekly').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncToDevAwaited(async (dev) => {
      const devLogId = crypto.randomUUID()
      const { error: devLogErr } = await dev
        .from('upload_log')
        .insert({ id: devLogId, table_name: logTableName, source_file: filename ?? 'unknown', record_count: records.length })
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'workforce_weekly', records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: devLogId })))
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
    // ON DELETE CASCADE removes workforce_weekly rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' },
      { status: 500 }
    )
  }
}
