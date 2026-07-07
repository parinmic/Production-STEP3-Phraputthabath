import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { syncToDevAwaited, batchInsert } from '@/lib/sync-to-dev'

const TABLE_NAME = 'master_logic_calc_mas_temp_qc'
const CALCULATION_TYPE = 'Mas Temp QC'

type TempColor = 'dark-green' | 'green' | 'yellow' | 'red'

interface TempRule {
  product_type: string
  condition: string
  color_label: string
  color: TempColor
  min_value: number | null
  max_value: number | null
  min_inclusive: boolean
  max_inclusive: boolean
  sort_order: number
}

function text(v: unknown): string {
  return String(v ?? '').trim()
}

function numFromText(v: string): number | null {
  const m = v.replace(',', '.').match(/\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

const HEX_COLOR_MAP: Record<string, TempColor> = {
  '006400': 'dark-green',
  '22C55E': 'green',
  'EAB308': 'yellow',
  'EF4444': 'red',
}

function normalizeColor(v: string): TempColor {
  const s = v.trim()
  const hex = s.replace('#', '').toUpperCase()
  if (HEX_COLOR_MAP[hex]) return HEX_COLOR_MAP[hex]
  if (s.includes('เขียวเข้ม')) return 'dark-green'
  if (s.includes('เหลือง')) return 'yellow'
  if (s.includes('แดง')) return 'red'
  return 'green'
}

function parseCondition(condition: string): Pick<TempRule, 'min_value' | 'max_value' | 'min_inclusive' | 'max_inclusive'> {
  const s = condition.replace(/\s+/g, ' ').trim()
  const range = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/)
  if (range) {
    return {
      min_value: Number(range[1]),
      max_value: Number(range[2]),
      min_inclusive: true,
      max_inclusive: true,
    }
  }

  if (s.includes('น้อยกว่า') || s.includes('<')) {
    return { min_value: null, max_value: numFromText(s), min_inclusive: true, max_inclusive: false }
  }

  if (s.includes('ขึ้นไป') || s.includes('มากกว่า') || s.includes('>=')) {
    return { min_value: numFromText(s), max_value: null, min_inclusive: true, max_inclusive: true }
  }

  return { min_value: null, max_value: null, min_inclusive: true, max_inclusive: true }
}

function normalizeRows(rows: Record<string, unknown>[]): TempRule[] {
  return rows
    .map((r, i) => {
      const product_type = text(r['ประเภท'] ?? r.product_type ?? r.type)
      const condition = text(r['เงื่อนไข'] ?? r.condition)
      const color_label = text(r['สี'] ?? r.color_label ?? r.color)
      if (!product_type || !condition || !color_label) return null
      return {
        product_type,
        condition,
        color_label,
        color: normalizeColor(color_label),
        ...parseCondition(condition),
        sort_order: i,
      }
    })
    .filter((r): r is TempRule => !!r)
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('rules')) {
    const { data: latestLog, error: logErr } = await supabase
      .from('upload_log')
      .select('id, source_file, uploaded_at')
      .eq('table_name', TABLE_NAME)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 })
    if (!latestLog) return NextResponse.json({ rules: [], sourceFile: '', uploadedAt: null })

    const { data, error } = await supabase
      .from('master_logic_calculation')
      .select('row_data')
      .eq('upload_log_id', latestLog.id)
      .eq('calculation_type', CALCULATION_TYPE)
      .order('uploaded_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rules = (data ?? [])
      .map(r => r.row_data as TempRule)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return NextResponse.json({ rules, sourceFile: latestLog.source_file, uploadedAt: latestLog.uploaded_at })
  }

  const { data } = await supabase
    .from('upload_log')
    .select('id, source_file, record_count, uploaded_at')
    .eq('table_name', TABLE_NAME)
    .order('uploaded_at', { ascending: false })
    .limit(20)
  return NextResponse.json({ uploads: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { rows, filename } = await req.json()
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ success: false, message: 'ไม่มีข้อมูล' }, { status: 400 })
    }

    const rules = normalizeRows(rows as Record<string, unknown>[])
    if (!rules.length) {
      return NextResponse.json({ success: false, message: 'ไม่พบคอลัมน์ ประเภท, เงื่อนไข, สี' }, { status: 400 })
    }

    const uploadLogId = crypto.randomUUID()
    const sourceFile = filename ?? 'unknown'
    const records = rules.map(rule => ({
      calculation_type: CALCULATION_TYPE,
      row_data: rule,
      source_file: sourceFile,
      upload_log_id: uploadLogId,
    }))

    const { error: logErr } = await supabase
      .from('upload_log')
      .insert({ id: uploadLogId, table_name: TABLE_NAME, source_file: sourceFile, record_count: records.length })
    if (logErr) throw logErr

    const { error } = await supabase.from('master_logic_calculation').insert(records)
    if (error) {
      await supabase.from('upload_log').delete().eq('id', uploadLogId)
      throw error
    }

    await syncToDevAwaited(async (dev) => {
      const devLogId = crypto.randomUUID()
      const { error: devLogErr } = await dev
        .from('upload_log')
        .insert({ id: devLogId, table_name: TABLE_NAME, source_file: sourceFile, record_count: records.length })
      if (devLogErr) throw devLogErr
      await batchInsert(dev, 'master_logic_calculation', records.map(r => ({ ...r, upload_log_id: devLogId })))
    })

    return NextResponse.json({ success: true, message: `บันทึกสำเร็จ ${records.length} รายการ` })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uploadLogId = req.nextUrl.searchParams.get('id')
    if (!uploadLogId) return NextResponse.json({ success: false, message: 'missing id' }, { status: 400 })
    await supabase.from('upload_log').delete().eq('id', uploadLogId)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'เกิดข้อผิดพลาด' }, { status: 500 })
  }
}
