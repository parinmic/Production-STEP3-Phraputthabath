import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const TABLE_CONFIG: Record<string, { cols: string[]; headers: Record<string, string> }> = {
  makro_orders: {
    cols: ['order_date', 'delivery_date', 'sku', 'sku_name', 'quantity', 'period', 'upload_round'],
    headers: {
      order_date:    'วันที่สั่ง',
      delivery_date: 'วันที่ส่ง',
      sku:           'SKU',
      sku_name:      'ชื่อสินค้า',
      quantity:      'ปริมาณ (กก.)',
      period:        'ช่วงเวลา',
      upload_round:  'รอบอัพโหลด',
    },
  },
  lotus_orders: {
    cols: ['order_date', 'delivery_date', 'sku', 'sku_name', 'quantity', 'period', 'upload_round'],
    headers: {
      order_date:    'วันที่สั่ง',
      delivery_date: 'วันที่ส่ง',
      sku:           'SKU',
      sku_name:      'ชื่อสินค้า',
      quantity:      'ปริมาณ (กก.)',
      period:        'ช่วงเวลา',
      upload_round:  'รอบอัพโหลด',
    },
  },
  wet_market_orders: {
    cols: ['order_date', 'delivery_date', 'sku', 'sku_name', 'quantity', 'period', 'upload_round'],
    headers: {
      order_date:    'วันที่สั่ง',
      delivery_date: 'วันที่ส่ง',
      sku:           'SKU',
      sku_name:      'ชื่อสินค้า',
      quantity:      'ปริมาณ (กก.)',
      period:        'ช่วงเวลา',
      upload_round:  'รอบอัพโหลด',
    },
  },
  production_plan_100: {
    cols: ['plan_date', 'station', 'seq', 'step', 'unix_code', 'sap', 'product_name', 'weight_per_bag', 'qty_bags', 'weight_total', 'lotus_bags', 'lotus_weight', 'cpft_bags', 'cpft_weight', 'makro_bags', 'makro_weight'],
    headers: {
      plan_date:      'วันที่แผน',
      station:        'สถานี',
      seq:            'ลำดับ',
      step:           'ขั้นตอน',
      unix_code:      'รหัส Unix',
      sap:            'รหัส SAP',
      product_name:   'ชื่อสินค้า',
      weight_per_bag: 'น้ำหนัก/ถุง',
      qty_bags:       'จำนวนถุง',
      weight_total:   'น้ำหนักรวม (กก.)',
      lotus_bags:     'ถุง Lotus',
      lotus_weight:   'น้ำหนัก Lotus (กก.)',
      cpft_bags:      'ถุง CPFT',
      cpft_weight:    'น้ำหนัก CPFT (กก.)',
      makro_bags:     'ถุง Makro',
      makro_weight:   'น้ำหนัก Makro (กก.)',
    },
  },
  channel_quotas: {
    cols: ['quota_date', 'channel', 'sku', 'sku_name', 'quantity'],
    headers: {
      quota_date: 'วันที่',
      channel:    'ช่องทาง',
      sku:        'SKU',
      sku_name:   'ชื่อสินค้า',
      quantity:   'ปริมาณ',
    },
  },
  daily_workforce: {
    cols: ['work_date', 'upload_round', 'plan_id', 'emp_id', 'name', 'home_dept', 'target_dept', 'work_station', 'shift', 'required_skill'],
    headers: {
      work_date:      'วันที่',
      upload_round:   'รอบ',
      plan_id:        'Plan ID',
      emp_id:         'รหัสพนักงาน',
      name:           'ชื่อ',
      home_dept:      'แผนกต้นสังกัด',
      target_dept:    'แผนกปลายทาง',
      work_station:   'สถานี',
      shift:          'กะ',
      required_skill: 'ทักษะที่ต้องการ',
    },
  },
  production_plan_supplementary: {
    cols: ['slot', 'sku', 'sku_name', 'quantity', 'order_date', 'delivery_date', 'loading_time', 'deadline_time'],
    headers: {
      slot:          'Slot',
      sku:           'SKU',
      sku_name:      'ชื่อสินค้า',
      quantity:      'ปริมาณ (กก.)',
      order_date:    'วันที่สั่ง',
      delivery_date: 'วันที่ส่ง',
      loading_time:  'เวลาโหลดจ่าย',
      deadline_time: 'เวลา Deadline',
    },
  },
  yield_bags: {
    cols: ['work_date', 'sap_code', 'bags'],
    headers: {
      work_date: 'วันที่',
      sap_code:  'รหัส SAP',
      bags:      'จำนวนถุง',
    },
  },
  stock_0010: {
    cols: ['material_code', 'material_name', 'spec_code', 'qty_1', 'weight_1', 'qty_2', 'weight_2', 'qty_3', 'weight_3', 'qty_total', 'weight_total', 'unit'],
    headers: {
      material_code: 'รหัสสินค้า',
      material_name: 'ชื่อสินค้า',
      spec_code:     'รหัส Spec',
      qty_1:         'ปริมาณ 1',
      weight_1:      'น้ำหนัก 1',
      qty_2:         'ปริมาณ 2',
      weight_2:      'น้ำหนัก 2',
      qty_3:         'ปริมาณ 3',
      weight_3:      'น้ำหนัก 3',
      qty_total:     'ปริมาณรวม',
      weight_total:  'น้ำหนักรวม',
      unit:          'หน่วย',
    },
  },
  stock_20: {
    cols: ['material_code', 'material_name', 'spec_code', 'qty_1', 'weight_1', 'qty_2', 'weight_2', 'qty_3', 'weight_3', 'qty_total', 'weight_total', 'unit'],
    headers: {
      material_code: 'รหัสสินค้า',
      material_name: 'ชื่อสินค้า',
      spec_code:     'รหัส Spec',
      qty_1:         'ปริมาณ 1',
      weight_1:      'น้ำหนัก 1',
      qty_2:         'ปริมาณ 2',
      weight_2:      'น้ำหนัก 2',
      qty_3:         'ปริมาณ 3',
      weight_3:      'น้ำหนัก 3',
      qty_total:     'ปริมาณรวม',
      weight_total:  'น้ำหนักรวม',
      unit:          'หน่วย',
    },
  },
  bom_items: {
    cols: ['pg', 'pg_name', 'product_code', 'product_sap', 'product_name', 'raw_code', 'raw_sap', 'raw_name', 'yield_pct', 'loss_pct'],
    headers: {
      pg:           'PG',
      pg_name:      'ชื่อ PG',
      product_code: 'รหัสสินค้า',
      product_sap:  'รหัส SAP สินค้า',
      product_name: 'ชื่อสินค้า',
      raw_code:     'รหัสวัตถุดิบ',
      raw_sap:      'รหัส SAP วัตถุดิบ',
      raw_name:     'ชื่อวัตถุดิบ',
      yield_pct:    'Yield %',
      loss_pct:     'Loss %',
    },
  },
  no_withdrawal_skus: {
    cols: ['work_station', 'product_group', 'sap', 'product_name'],
    headers: {
      work_station:  'จุดงาน',
      product_group: 'กลุ่มสินค้า',
      sap:           'SAP',
      product_name:  'ชื่อสินค้า',
    },
  },
  picking_unit_master: {
    cols: ['step', 'unix_code', 'sap', 'product_name', 'weight_per_bag', 'unit'],
    headers: {
      step:           'ขั้นตอน',
      unix_code:      'รหัส Unix',
      sap:            'SAP',
      product_name:   'ชื่อสินค้า',
      weight_per_bag: 'น้ำหนักต่อถุง',
      unit:           'หน่วย',
    },
  },
}

async function fetchAllRows(
  table: string,
  select: string,
  sourceFile: string,
  slot?: string | null
): Promise<{ data: any[]; error: any }> {
  const PAGE = 1000
  const all: any[] = []
  let from = 0
  while (true) {
    let q = supabase
      .from(table)
      .select(select)
      .eq('source_file', sourceFile)
      .range(from, from + PAGE - 1)

    if (slot && table === 'production_plan_supplementary') {
      q = q.eq('slot', slot)
    }

    const { data, error } = await q
    if (error) return { data: [], error }
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return { data: all, error: null }
}

export async function GET(req: NextRequest) {
  const table      = req.nextUrl.searchParams.get('table') ?? ''
  const sourceFile = req.nextUrl.searchParams.get('file')  ?? ''
  const slot       = req.nextUrl.searchParams.get('slot')

  if (!table || !sourceFile) {
    return NextResponse.json({ error: 'missing table or file' }, { status: 400 })
  }

  // Handle master logic tables (JSONB row_data format)
  const isMasterTable = table === 'master_logic_calculation' || table === 'master_logic_manpower'
  if (isMasterTable) {
    const { data, error } = await fetchAllRows(table, 'row_data', sourceFile)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || !data.length) return NextResponse.json({ headers: {}, data: [] })

    // Flatten rows
    const rows = data.map(r => (r.row_data ?? {}) as Record<string, unknown>)
    
    // Dynamically build headers mapping (key -> key)
    const allKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
    const headers: Record<string, string> = {}
    for (const k of allKeys) {
      headers[k] = k
    }

    return NextResponse.json({ headers, data: rows })
  }

  const config = TABLE_CONFIG[table]
  if (!config) {
    return NextResponse.json({ error: `unknown table: ${table}` }, { status: 400 })
  }

  const { data, error } = await fetchAllRows(table, config.cols.join(','), sourceFile, slot)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ headers: config.headers, data: data ?? [] })
}
