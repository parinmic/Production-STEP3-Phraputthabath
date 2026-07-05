const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.DEV_SYNC_SUPABASE_URL, process.env.DEV_SYNC_SUPABASE_ANON_KEY)

async function fetchAll() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('mas_yield')
      .select('carcass_weight,product_group,yield_pct,upload_log_id')
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

fetchAll()
  .then(all => {
    const byKey = new Map()
    for (const r of all) {
      const key = `${r.carcass_weight}|||${r.product_group}`
      const e = byKey.get(key) || { key, count: 0, sum: 0, vals: new Set(), logs: new Set() }
      e.count += 1
      e.sum += Number(r.yield_pct || 0)
      e.vals.add(Number(r.yield_pct || 0))
      if (r.upload_log_id) e.logs.add(r.upload_log_id)
      byKey.set(key, e)
    }

    const duplicates = Array.from(byKey.values()).filter(e => e.count > 1)
    console.log(JSON.stringify({
      rows: all.length,
      uniqueKeys: byKey.size,
      duplicateKeys: duplicates.length,
      topDuplicates: duplicates
        .sort((a, b) => b.count - a.count)
        .slice(0, 25)
        .map(e => ({
          key: e.key,
          count: e.count,
          summedYieldPct: Math.round(e.sum * 10000) / 10000,
          distinctYieldPct: Array.from(e.vals).slice(0, 8),
          uploadLogs: e.logs.size,
        })),
    }, null, 2))
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
