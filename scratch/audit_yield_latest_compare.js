const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.DEV_SYNC_SUPABASE_URL, process.env.DEV_SYNC_SUPABASE_ANON_KEY)

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

const num = v => Number.isFinite(Number(v)) ? Number(v) : 0
const round1 = v => Math.round(v * 10) / 10

async function main() {
  const date = process.argv[2] || '2026-07-03'
  const [assignments, yields, logs] = await Promise.all([
    fetchAll('production_assignments', 'production_date,table_name,sku,sku_name,target_quantity,period,channel,note,effective_from', q => q.eq('production_date', date)),
    fetchAll('mas_yield', 'carcass_weight,product_group,yield_pct,upload_log_id'),
    fetchAll('upload_log', 'id,table_name,source_file,uploaded_at', q => q.eq('table_name', 'mas_yield').order('uploaded_at', { ascending: false })),
  ])

  const latestLog = logs[0]
  const latestYields = latestLog ? yields.filter(r => r.upload_log_id === latestLog.id) : []

  const latestKey = new Map()
  for (const r of assignments) {
    const k = `${r.table_name}|||${r.period}`
    const eff = r.effective_from || ''
    if (!latestKey.has(k) || eff > latestKey.get(k)) latestKey.set(k, eff)
  }
  const latestAssignments = assignments.filter(r => latestKey.get(`${r.table_name}|||${r.period}`) === (r.effective_from || ''))
  const remainders = latestAssignments
    .filter(r => String(r.note || '').includes('yield_remainder'))
    .reduce((m, r) => {
      const k = `${r.sku}|||${r.sku_name}|||${r.table_name}`
      const cur = m.get(k) || { sku: r.sku, name: r.sku_name, table: r.table_name, qty: 0 }
      cur.qty += num(r.target_quantity)
      m.set(k, cur)
      return m
    }, new Map())

  const summarizeYield = rows => {
    const keyCount = new Map()
    let pctSum = 0
    for (const r of rows) {
      keyCount.set(`${r.carcass_weight}|||${r.product_group}`, 1)
      pctSum += num(r.yield_pct)
    }
    return { rows: rows.length, uniqueKeys: keyCount.size, pctSum: round1(pctSum) }
  }

  console.log(JSON.stringify({
    date,
    latestMasYieldUpload: latestLog || null,
    masYieldAll: summarizeYield(yields),
    masYieldLatest: summarizeYield(latestYields),
    duplicateInflationFactorByRows: latestYields.length ? Math.round((yields.length / latestYields.length) * 100) / 100 : null,
    latestAssignmentRows: latestAssignments.length,
    yieldRemainderSkus: Array.from(remainders.values()).sort((a, b) => b.qty - a.qty).map(r => ({
      ...r,
      qty: round1(r.qty),
    })),
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
