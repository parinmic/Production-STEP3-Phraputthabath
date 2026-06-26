// full-reload-prod-to-dev.js — TRUNCATE dev tables (already done via SQL) then
// fully reload them from production so dev matches production byte-for-byte.
// Run: node scripts/full-reload-prod-to-dev.js
//
// Use this (instead of the anti-join approach in sync-missing-prod-to-dev.js)
// for tables that get periodically replaced by date range (delete+insert),
// where an id-based anti-join can't detect stale dev-only rows left over
// from a date range that production has since overwritten.

const { createClient } = require('@supabase/supabase-js')

const PROD_URL = 'https://jtjironqszdfsflvdvld.supabase.co'
const PROD_KEY = 'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
const DEV_URL  = 'https://hmcppjhjybqmlxhdbmbh.supabase.co'
const DEV_KEY  = 'sb_publishable_f1cEeDCEH6m2NjkiJlJclQ_zle7sXnI'

const prod = createClient(PROD_URL, PROD_KEY)
const dev  = createClient(DEV_URL,  DEV_KEY)

const BATCH = 500

// All of these use uuid PK with a default (not ALWAYS GENERATED identity),
// so the id is preserved verbatim — dev tables must already be empty (TRUNCATEd).
const TABLES = [
  'lotus_orders',
  'wet_market_orders',
  'makro_orders',
  'production_assignments',
  'withdrawal_requests',
  'production_actual',
  'upload_log',
]

async function reloadTable(name) {
  const { count, error: cErr } = await prod.from(name).select('*', { count: 'exact', head: true })
  if (cErr) throw new Error(`count error: ${cErr.message}`)
  if (count === 0) {
    process.stdout.write(`  ${name}: 0 rows — skipped\n`)
    return
  }

  const rows = []
  for (let from = 0; from < count; from += BATCH) {
    const { data, error } = await prod.from(name).select('*').range(from, from + BATCH - 1)
    if (error) throw new Error(`read error at ${from}: ${error.message}`)
    rows.push(...data)
    process.stdout.write(`\r  ${name}: read ${rows.length}/${count}   `)
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await dev.from(name).insert(batch)
    if (error) throw new Error(`insert error at ${i}: ${error.message}`)
    process.stdout.write(`\r  ${name}: inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}   `)
  }

  process.stdout.write(`\r  ${name}: done (${rows.length} rows)            \n`)
}

async function main() {
  console.log('=== Full reload: Production -> Dev (after TRUNCATE) ===\n')
  let ok = 0, fail = 0
  for (const t of TABLES) {
    try {
      await reloadTable(t)
      ok++
    } catch (e) {
      console.error(`\n  ERROR [${t}]: ${e.message}`)
      fail++
    }
  }
  console.log(`\n=== Done: ${ok} ok, ${fail} failed ===`)
}

main()
