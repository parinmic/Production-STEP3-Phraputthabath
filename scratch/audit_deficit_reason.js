const { createClient } = require('@supabase/supabase-js')

const url = process.env.DEV_SYNC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.DEV_SYNC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const date = process.argv[2] || '2026-07-01'
const skus = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean)

const supabase = createClient(url, key)
const BASIC_STATIONS = ['สะโพกเบสิค', 'สามชั้นเบสิค', 'ไหล่เบสิค']

function normSku(v) { return String(v ?? '').trim().replace(/^0+/, '') }

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

async function main() {
  const rows = await fetchAll('production_assignments', 'table_name,sku,sku_name,target_quantity,period,channel,note,effective_from,is_deficit,worker_name,deadline_time', q => q.eq('production_date', date).in('table_name', BASIC_STATIONS))
  const latestKey = new Map()
  for (const r of rows) {
    const k = `${r.table_name}|||${r.period}`
    const eff = r.effective_from || ''
    if (!latestKey.has(k) || eff > latestKey.get(k)) latestKey.set(k, eff)
  }
  const latest = rows.filter(r => latestKey.get(`${r.table_name}|||${r.period}`) === (r.effective_from || ''))
  const filtered = latest.filter(r => skus.length === 0 || skus.includes(normSku(r.sku)))
  for (const r of filtered) {
    console.log(normSku(r.sku), '|', r.sku_name, '|', r.table_name, '|', r.period, '| qty=', r.target_quantity, '| deficit=', r.is_deficit, '| note=', r.note, '| worker=', r.worker_name, '| deadline=', r.deadline_time)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
