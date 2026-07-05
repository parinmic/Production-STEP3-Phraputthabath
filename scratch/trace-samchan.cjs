const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  'https://hmcppjhjybqmlxhdbmbh.supabase.co',
  'sb_publishable_f1cEeDCEH6m2NjkiJlJclQ_zle7sXnI'
)

const productionDate = '2026-07-01'
const TT_SKUS = ['23057674','23057675','23057677','23057678','23057685','23057687','23057688','23057689','23057691','23057695','23057700','23057701','23057702','23045518','23105856']

function buildAvgMap(rows) {
  const bySkuDate = {}
  for (const r of rows) {
    const sku = r.sku.replace(/^0+/, '')
    if (!bySkuDate[sku]) bySkuDate[sku] = {}
    bySkuDate[sku][r.delivery_date] = (bySkuDate[sku][r.delivery_date] ?? 0) + Number(r.quantity)
  }
  const result = new Map()
  for (const sku of Object.keys(bySkuDate)) {
    const vals = Object.values(bySkuDate[sku])
    result.set(sku, vals.reduce((s, v) => s + v, 0) / vals.length)
  }
  return result
}

async function fetchAll(table, cols, filters) {
  const PAGE = 1000
  const all = []
  let from = 0
  while (true) {
    let q = supabase.from(table).select(cols)
    for (const f of filters) {
      if (f.op === 'eq') q = q.eq(f.col, f.val)
      if (f.op === 'in') q = q.in(f.col, f.val)
    }
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw error
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function main() {
  const d = new Date(productionDate)
  const histDates = [1, 2, 3, 4, 5, 6, 7].map(n => {
    const h = new Date(d); h.setDate(d.getDate() - n)
    return h.toISOString().split('T')[0]
  })
  console.log('histDates:', histDates)

  const [wmHist, lotusHist, prodMasterRaw, varWMRaw, varLotusRaw] = await Promise.all([
    fetchAll('wet_market_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'in', val: histDates }, { col: 'upload_round', op: 'eq', val: '1600' }]),
    fetchAll('lotus_orders', 'sku, sku_name, quantity, delivery_date',
      [{ col: 'delivery_date', op: 'in', val: histDates }, { col: 'upload_round', op: 'eq', val: '1600' }]),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas Productivity Basic').order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance Wet Market Basic').order('uploaded_at', { ascending: false }).limit(5000),
    supabase.from('master_logic_calculation').select('row_data')
      .eq('calculation_type', 'Mas %Variance LOTUS Basic').order('uploaded_at', { ascending: false }).limit(5000),
  ])

  console.log('wmHist rows:', wmHist.length, 'lotusHist rows:', lotusHist.length)

  const avgWM = buildAvgMap(wmHist)
  const avgLotus = buildAvgMap(lotusHist)

  // Build skuMap like real code (first-seen wins, data already ordered uploaded_at desc)
  const skuMap = new Map()
  for (const row of (prodMasterRaw.data ?? [])) {
    const r = row.row_data
    const sap = String(r['SAP'] ?? '').trim()
    if (!sap) continue
    const prod = {
      sku: sap,
      sku_name: String(r['ชื่อสินค้า'] ?? ''),
      product_group: String(r['กลุ่มสินค้า'] ?? ''),
      station: String(r['จุดงาน'] ?? ''),
      product: String(r['Product'] ?? ''),
    }
    if (!skuMap.has(prod.sku)) skuMap.set(prod.sku, prod)
    const norm = prod.sku.replace(/^0+/, '')
    if (!skuMap.has(norm)) skuMap.set(norm, prod)
  }

  const wmVar = new Map()
  for (const row of (varWMRaw.data ?? [])) {
    const r = row.row_data
    const sku = String(r['SAP'] ?? '').trim().replace(/^0+/, '')
    const pct = Number(r['%Var'] ?? 0)
    if (sku && pct > 0 && !wmVar.has(sku)) wmVar.set(sku, pct)
  }
  const lotusVar = new Map()
  for (const row of (varLotusRaw.data ?? [])) {
    const r = row.row_data
    const sku = String(r['SAP'] ?? '').trim().replace(/^0+/, '')
    const pct = Number(r['%Var'] ?? 0)
    if (sku && pct > 0 && !lotusVar.has(sku)) lotusVar.set(sku, pct)
  }

  console.log('\n=== Per-SKU trace (Phase 1 เช้า target formula: avg * variance) ===')
  for (const sku of TT_SKUS) {
    const prod = skuMap.get(sku)
    const aWM = avgWM.get(sku) ?? 0
    const aLotus = avgLotus.get(sku) ?? 0
    const vWM = wmVar.get(sku) ?? 0
    const vLotus = lotusVar.get(sku) ?? 0
    const targetWM = aWM * vWM
    const targetLotus = aLotus * vLotus
    console.log(`${sku} ${(prod?.sku_name ?? '???').padEnd(20)} grp=${(prod?.product_group ?? 'NOTFOUND').padEnd(15)} station=${(prod?.station ?? 'NOTFOUND').padEnd(15)} | avgWM=${aWM.toFixed(1)} varWM=${vWM} => targetWM=${targetWM.toFixed(1)} | avgLotus=${aLotus.toFixed(1)} varLotus=${vLotus} => targetLotus=${targetLotus.toFixed(1)}`)
  }
}
main().catch(e => console.error('ERROR', e))
