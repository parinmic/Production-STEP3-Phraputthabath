const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.DEV_SYNC_SUPABASE_URL, process.env.DEV_SYNC_SUPABASE_ANON_KEY)
const date = process.argv[2] || '2026-07-03'

const BASIC_STATIONS = ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค']
const normSku = v => String(v ?? '').trim().replace(/^0+/, '')
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0
const round1 = v => Math.round(v * 10) / 10

async function fetchAll(table, select, build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999)
    if (build) q = build(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

function rowValue(row, names) {
  for (const name of names) if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]
  return undefined
}

function percentValue(v) {
  const n = num(v)
  return n > 1 ? n / 100 : n
}

async function main() {
  const d = new Date(`${date}T00:00:00Z`)
  const makroTrendDates = [7, 14].map(n => {
    const h = new Date(d)
    h.setUTCDate(h.getUTCDate() - n)
    return h.toISOString().slice(0, 10)
  })

  const [
    assignments,
    makroToday,
    makro0800Hist,
    makro1400Hist,
    prodRaw,
    varMakroRaw,
    pickingRows,
  ] = await Promise.all([
    fetchAll('production_assignments', 'table_name,sku,sku_name,target_quantity,period,channel,note,effective_from', q => q.eq('production_date', date).in('table_name', BASIC_STATIONS)),
    fetchAll('makro_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date).eq('upload_round', '0800')),
    fetchAll('makro_orders', 'sku,quantity,delivery_date,upload_round', q => q.in('delivery_date', makroTrendDates).eq('upload_round', '0800')),
    fetchAll('makro_orders', 'sku,quantity,delivery_date,upload_round', q => q.in('delivery_date', makroTrendDates).eq('upload_round', '1400')),
    fetchAll('master_logic_calculation', 'row_data,uploaded_at', q => q.eq('calculation_type', 'Mas Productivity Basic').order('uploaded_at', { ascending: false })),
    fetchAll('master_logic_calculation', 'row_data,uploaded_at', q => q.eq('calculation_type', 'Mas %Variance Makro Basic').order('uploaded_at', { ascending: false })),
    fetchAll('picking_unit_master', 'sap,weight_per_bag'),
  ])

  const latestByStationPeriod = new Map()
  for (const r of assignments) {
    const key = `${r.table_name}|||${r.period}`
    if (!latestByStationPeriod.has(key) || (r.effective_from || '') > latestByStationPeriod.get(key)) latestByStationPeriod.set(key, r.effective_from || '')
  }
  const latest = assignments.filter(r => latestByStationPeriod.get(`${r.table_name}|||${r.period}`) === (r.effective_from || ''))

  const prodBySku = new Map()
  for (const row of prodRaw) {
    const r = row.row_data || {}
    const sku = normSku(rowValue(r, ['SAP', 'sap', 'sku']))
    if (!sku || prodBySku.has(sku)) continue
    prodBySku.set(sku, {
      name: String(rowValue(r, ['ชื่อสินค้า', 'sku_name', 'product_name']) ?? '').trim(),
      group: String(rowValue(r, ['กลุ่มสินค้า', 'product_group']) ?? '').trim(),
    })
  }

  const varianceByGroup = new Map()
  for (const row of varMakroRaw) {
    const r = row.row_data || {}
    const group = String(rowValue(r, ['กลุ่มสินค้า', 'product_group']) ?? '').trim()
    const trend = String(rowValue(r, ['แนวโน้ม <1 = เพิ่ม, >1 = ลด', 'แนวโน้ม', 'trend']) ?? '').trim()
    const pct = percentValue(rowValue(r, ['%Variance', '%Var']))
    if (!group || !trend || pct <= 0) continue
    const cur = varianceByGroup.get(group) || {}
    if (/^</.test(trend)) cur.ltOne = pct
    else cur.gteOne = pct
    varianceByGroup.set(group, cur)
  }

  const wpbBySku = new Map()
  for (const r of pickingRows) {
    const sku = normSku(r.sap)
    const wpb = num(r.weight_per_bag)
    if (sku && wpb > 0) wpbBySku.set(sku, wpb)
  }
  const roundUpToBag = (sku, qty) => {
    const wpb = wpbBySku.get(sku)
    return wpb ? Math.round(Math.ceil(qty / wpb) * wpb * 100) / 100 : Math.round(qty * 100) / 100
  }

  const sumBySku = rows => rows.reduce((m, r) => {
    const sku = normSku(r.sku)
    m.set(sku, (m.get(sku) || 0) + num(r.quantity))
    return m
  }, new Map())

  const orderBySku = sumBySku(makroToday)
  const hist0800 = sumBySku(makro0800Hist)
  const hist1400 = sumBySku(makro1400Hist)

  const expectedMakro = new Map()
  for (const [sku, orderQty] of orderBySku) {
    const group = prodBySku.get(sku)?.group || ''
    const trend = (hist1400.get(sku) || 0) > 0 ? (hist0800.get(sku) || 0) / (hist1400.get(sku) || 0) : null
    const variance = trend !== null && trend < 1
      ? (varianceByGroup.get(group)?.ltOne ?? 1)
      : (varianceByGroup.get(group)?.gteOne ?? 1)
    expectedMakro.set(sku, roundUpToBag(sku, orderQty * variance))
  }

  const actualMakro = new Map()
  for (const r of latest) {
    if (r.channel !== 'Makro') continue
    if (String(r.note || '').includes('remainder')) continue
    const sku = normSku(r.sku)
    actualMakro.set(sku, (actualMakro.get(sku) || 0) + num(r.target_quantity))
  }

  const issues = Array.from(actualMakro.entries())
    .map(([sku, actual]) => ({
      sku,
      name: prodBySku.get(sku)?.name || '',
      actual: round1(actual),
      expected: round1(expectedMakro.get(sku) || 0),
      diff: round1(actual - (expectedMakro.get(sku) || 0)),
      order: round1(orderBySku.get(sku) || 0),
    }))
    .filter(r => r.actual > r.expected + Math.max(5, (r.expected || 0) * 0.05))
    .sort((a, b) => b.diff - a.diff)

  console.log(JSON.stringify({ date, issueCount: issues.length, issues }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
