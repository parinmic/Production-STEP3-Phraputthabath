import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const sourceFile = req.nextUrl.searchParams.get('file')

  // download mode: return full row_data for a specific file
  if (sourceFile) {
    const { data, error } = await supabase
      .from('workforce_weekly')
      .select('row_data')
      .eq('source_file', sourceFile)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data: data ?? [] })
  }

  const { data } = await supabase
    .from('upload_log')
    .select('source_file, record_count, uploaded_at')
    .eq('table_name', 'workforce_weekly')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows.map((r: Record<string, unknown>) => ({
      source_file: filename ?? 'unknown',
      row_data:    r,
    })).filter((r: { row_data: Record<string, unknown> }) => Object.values(r.row_data).some(v => v !== null && v !== ''))

    if (!records.length)
      return NextResponse.json({ success: false, message: 'ไม่พบข้อมูลที่ใช้งานได้' }, { status: 400 })

    await supabase.from('workforce_weekly').delete().eq('source_file', filename ?? 'unknown')

    const { error } = await supabase.from('workforce_weekly').insert(records)
    if (error) throw error

    await supabase.from('upload_log').insert({
      table_name:   'workforce_weekly',
      source_file:  filename ?? 'unknown',
      record_count: records.length,
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sourceFile = req.nextUrl.searchParams.get('file')
    if (!sourceFile) return NextResponse.json({ success: false, message: 'missing file' }, { status: 400 })
    await supabase.from('workforce_weekly').delete().eq('source_file', sourceFile)
    await supabase.from('upload_log').delete()
      .eq('table_name', 'workforce_weekly')
      .eq('source_file', sourceFile)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' },
      { status: 500 }
    )
  }
}
