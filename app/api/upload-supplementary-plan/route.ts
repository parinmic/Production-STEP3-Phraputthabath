import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, syncUploadToDev } from '@/lib/sync-to-dev'

function toISODate(val: unknown): string | null {
  if (!val) return null
  const s = String(val).trim()
  if (!s || s === 'null') return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const y = parseInt(s); return y > 2400 ? `${y - 543}${s.slice(4)}` : s }
  if (s.includes('T')) { const d = s.split('T')[0]; const y = parseInt(d); return y > 2400 ? `${y - 543}${d.slice(4)}` : d }
  const parts = s.split('/')
  if (parts.length === 3) {
    const [d, m, y] = parts
    const year = parseInt(y) > 2400 ? parseInt(y) - 543 : parseInt(y)
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const num = parseFloat(s)
  if (!isNaN(num) && num > 40000) {
    const d = new Date(Math.round((num - 25569) * 86400 * 1000))
    const y = d.getUTCFullYear() > 2400 ? d.getUTCFullYear() - 543 : d.getUTCFullYear()
    return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

export async function GET() {
  // Fetch all logs for all supplementary slots — no req needed, no query params
  const { data: logs } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at, table_name')
    .like('table_name', 'production_plan_supplementary_%')
    .order('uploaded_at', { ascending: false })
    .limit(60)

  // Group by source_file to consolidate split logs
  const fileMap = new Map<string, { source_file: string; record_count: number; uploaded_at: string; slots: string[] }>()
  for (const r of logs ?? []) {
    const file = r.source_file
    const slotNum = r.table_name.replace('production_plan_supplementary_', '')
    if (!fileMap.has(file)) {
      fileMap.set(file, {
        source_file: file,
        record_count: r.record_count,
        uploaded_at: r.uploaded_at,
        slots: [slotNum],
      })
    } else {
      const cur = fileMap.get(file)!
      cur.record_count += r.record_count
      if (!cur.slots.includes(slotNum)) cur.slots.push(slotNum)
    }
  }

  const uploads = await Promise.all(Array.from(fileMap.values()).map(async r => {
    // Fetch loading info
    const { data: recs } = await supabase
      .from('production_plan_supplementary')
      .select('loading_time, deadline_time, delivery_date')
      .eq('source_file', r.source_file)
      .limit(1)

    const rec = recs?.[0]
    return {
      source_file:   r.source_file,
      record_count:  r.record_count,
      uploaded_at:   r.uploaded_at,
      loading_time:  rec?.loading_time ?? null,
      deadline_time: rec?.deadline_time ?? null,
      delivery_date: rec?.delivery_date ?? null,
      slots:         r.slots,
    }
  }))

  return NextResponse.json({ uploads })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!rows?.length) return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })

    const cols = Object.keys(rows[0])
    const hasNativeFormat = cols.some(c => c.startsWith('r') && c.length > 2)

    const records = rows
      .map((r: Record<string, unknown>) => {
        let sku = '', sku_name = '', quantity = 0, delivery_date: string | null = null, order_date: string | null = null
        let loading_time = '', deadline_time = '', slot = '1'

        if (hasNativeFormat) {
          const skuCol  = cols.includes('rProduct_code') ? 'rProduct_code'
                        : (cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('code')) ?? '')
          const nameCol = cols.includes('rProduct_name') ? 'rProduct_name'
                        : (cols.find(c => c.toLowerCase().includes('product') && c.toLowerCase().includes('name')) ?? '')
          const qtyCol  = cols.includes('rStock_wgt') ? 'rStock_wgt'
                        : cols.includes('rPlan_wgt') ? 'rPlan_wgt'
                        : (cols.find(c => c.toLowerCase().includes('wgt') || c.toLowerCase().includes('qty')) ?? '')
          const dateCol = cols.includes('rDoc_date') ? 'rDoc_date'
                        : (cols.find(c => c.toLowerCase().includes('doc') && c.toLowerCase().includes('date')) ?? '')
          const dlvCol  = cols.includes('rRDate1') ? 'rRDate1'
                        : cols.includes('rReq_date') ? 'rReq_date'
                        : (cols.find(c => c.toLowerCase().includes('req') || c.toLowerCase().includes('rdate')) ?? '')
          sku           = String(r[skuCol] ?? '').trim()
          sku_name      = String(r[nameCol] ?? '').trim()

          let qty = parseFloat(String(r[qtyCol] || '0')) || 0
          if (qty === 0 && cols.includes('rPlan_wgt')) {
            qty = parseFloat(String(r['rPlan_wgt'] ?? '0')) || 0
          }
          quantity      = qty
          order_date    = toISODate(r[dateCol])
          delivery_date = toISODate(r[dlvCol])

          // Native Excel format doesn't have loading times; default to slot 1, 10:00
          loading_time  = '10:00'
          deadline_time = '09:30'
          slot          = '1'
        } else {
          sku           = String(r['SKU'] ?? r['รหัสสินค้า'] ?? '').trim()
          sku_name      = String(r['ชื่อสินค้า'] ?? r['product_name'] ?? '').trim()
          quantity      = Number(r['ปริมาณ'] ?? r['จำนวน'] ?? r['qty'] ?? 0) || 0
          order_date    = toISODate(r['วันที่สั่ง'] ?? r['order_date'])
          delivery_date = toISODate(r['วันที่ส่ง'] ?? r['delivery_date'])
          loading_time  = String(r['loading_time'] ?? r['เวลาต้องโหลด'] ?? '10:00').trim()
          deadline_time = String(r['deadline_time'] ?? '').trim()

          // Determine slot based on loading time:
          // Slot 1: loading time <= 14:00
          // Slot 2: loading time > 14:00 and <= 16:00
          // Slot 3: loading time > 16:00
          if (loading_time) {
            const [hStr, mStr] = loading_time.split(':')
            const h = parseInt(hStr) || 0
            const m = parseInt(mStr) || 0
            const totalMins = h * 60 + m
            if (totalMins <= 14 * 60) {
              slot = '1'
            } else if (totalMins <= 16 * 60) {
              slot = '2'
            } else {
              slot = '3'
            }
          } else {
            slot = '1'
          }

          if (!deadline_time && loading_time) {
            const [hStr, mStr] = loading_time.split(':')
            const h = parseInt(hStr) || 0
            const m = parseInt(mStr) || 0
            const total = h * 60 + m - 30
            const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60)
            const mm = ((total % 1440) + 1440) % 1440 % 60
            deadline_time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
          }
        }

        return { slot, sku, sku_name, quantity, order_date, delivery_date, loading_time, deadline_time, source_file: filename ?? 'unknown' }
      })
      .filter((r: { sku: string; quantity: number }) => r.sku && r.quantity > 0)

    if (!records.length) {
      return NextResponse.json({
        success: false,
        message: `ไม่พบรายการที่ถูกต้อง — columns ที่พบ: ${cols.join(', ')}`,
      }, { status: 400 })
    }

    // Group records by slot to create per-slot upload_log entries
    const slotGroups: Record<string, number> = {}
    for (const rec of records) {
      slotGroups[rec.slot] = (slotGroups[rec.slot] || 0) + 1
    }

    // Create upload_log entries per slot (first slot entry's id tags all data rows,
    // supplementary uses source_file-based grouping in GET so we insert multiple log entries)
    const firstSlot = Object.keys(slotGroups)[0]
    const firstTableName = `production_plan_supplementary_${firstSlot}`
    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: firstTableName, source_file: filename ?? 'unknown', record_count: records.length })
    if (logErr) throw logErr

    // Insert remaining slot log entries (CASCADE will clean them via source_file-level delete)
    for (const [s, count] of Object.entries(slotGroups)) {
      if (s === firstSlot) continue
      const tableName = `production_plan_supplementary_${s}`
      await supabase.from('upload_log').insert({
        id:           crypto.randomUUID(),
        table_name:   tableName,
        source_file:  filename ?? 'unknown',
        record_count: count,
      })
    }

    const recordsWithId = records.map((r: Record<string, unknown>) => ({ ...r, upload_log_id: uploadLogId }))
    const { error } = await supabase.from('production_plan_supplementary').insert(recordsWithId)
    if (error) {
      await supabase.from('upload_log').delete().eq('source_file', filename ?? 'unknown')
      throw error
    }

    await syncUploadToDev(firstTableName, filename ?? 'unknown', records)
    // For remaining slots, insert their upload_log entries on dev (data rows all tagged with firstSlot's id)
    await syncToDevAwaited(async (dev) => {
      for (const [s, count] of Object.entries(slotGroups)) {
        if (s === firstSlot) continue
        await dev.from('upload_log').insert({
          id:           crypto.randomUUID(),
          table_name:   `production_plan_supplementary_${s}`,
          source_file:  filename ?? 'unknown',
          record_count: count,
        })
      }
    })
    return NextResponse.json({
      success: true,
      message: `บันทึกสำเร็จ ${records.length} รายการ`,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'เกิดข้อผิดพลาด'
    return NextResponse.json({ success: false, message: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    // ON DELETE CASCADE removes production_plan_supplementary rows automatically
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
