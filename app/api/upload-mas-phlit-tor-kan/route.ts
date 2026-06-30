import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncUploadToDev } from '@/lib/sync-to-dev'

export async function GET() {
  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', 'mas_phlit_tor_kan')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const records = rows
      .map((r: Record<string, unknown>) => ({
        product_group:  String(r['product_group']  ?? '').trim() || null,
        sap:            String(r['sap']             ?? '').trim(),
        sku_name:       String(r['sku_name']        ?? '').trim() || null,
        source_station: String(r['source_station']  ?? '').trim() || null,
        dest_station:   String(r['dest_station']    ?? '').trim() || null,
      }))
      .filter((r: { sap: string }) => r.sap)

    if (!records.length) return NextResponse.json({ success: false, message: 'ไม่พบรายการที่ถูกต้อง (ต้องมีรหัส SAP)' }, { status: 400 })

    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: 'mas_phlit_tor_kan', source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('mas_phlit_tor_kan').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw new Error(error.message ?? error.details ?? JSON.stringify(error))
    }

    await syncUploadToDev('mas_phlit_tor_kan', filename ?? 'unknown', records)
    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes mas_phlit_tor_kan rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
