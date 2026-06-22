// sync-prod-to-dev.js — copy all tables from Production DB → Dev DB
// Run: node scripts/sync-prod-to-dev.js

const { createClient } = require('@supabase/supabase-js')

const PROD_URL = 'https://jtjironqszdfsflvdvld.supabase.co'
const PROD_KEY = 'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
const DEV_URL  = 'https://hmcppjhjybqmlxhdbmbh.supabase.co'
const DEV_KEY  = 'sb_publishable_f1cEeDCEH6m2NjkiJlJclQ_zle7sXnI'

const prod = createClient(PROD_URL, PROD_KEY)
const dev  = createClient(DEV_URL,  DEV_KEY)

// Tables whose `id` is ALWAYS GENERATED — must strip before insert
const IDENTITY_TABLES = new Set([
  'bom_items', 'production_plan_100', 'picking_unit_master',
  'mas_yield', 'no_withdrawal_skus', 'moo_chod_master',
  'moo_chod_withdrawal_master', 'bom_items_basic',
  'picking_unit_master_basic', 'mas_raw_production_advance',
  'mas_saw_machine_sku',
])

const TABLES = [
  // master / lookup (small — sync first)
  'sku_master',
  'bom_items',
  'bom_items_basic',
  'picking_unit_master',
  'picking_unit_master_basic',
  'mas_yield',
  'mas_sayapan',
  'mas_priority_withdrawal',
  'mas_saw_machine_sku',
  'mas_raw_production_advance',
  'moo_chod_master',
  'moo_chod_withdrawal_master',
  'no_withdrawal_skus',
  'master_logic_manpower',
  'master_logic_calculation',
  // stock
  'stock_0010',
  'stock_20',
  // orders / plan (large)
  'lotus_orders',
  'wet_market_orders',
  'makro_orders',
  'channel_quotas',
  'production_plan_100',
  'production_plan_supplementary',
  // operations
  'production_assignments',
  'production_actual',
  'yield_bags',
  'withdrawal_requests',
  'daily_workforce',
  'workforce_weekly',
  'workforce_daily_status',
  'wip_plan',
  'upload_log',
]

const BATCH = 500

async function syncTable(name) {
  // count rows in production
  const { count, error: cErr } = await prod
    .from(name).select('*', { count: 'exact', head: true })
  if (cErr) throw new Error(`count error: ${cErr.message}`)

  if (count === 0) {
    process.stdout.write(`  ${name}: 0 rows — skipped\n`)
    return
  }

  // read all from production in batches
  const rows = []
  for (let from = 0; from < count; from += BATCH) {
    const { data, error } = await prod.from(name).select('*').range(from, from + BATCH - 1)
    if (error) throw new Error(`read error at ${from}: ${error.message}`)
    rows.push(...data)
    process.stdout.write(`\r  ${name}: read ${rows.length}/${count}   `)
  }

  // strip id for ALWAYS GENERATED identity tables
  const toInsert = IDENTITY_TABLES.has(name)
    ? rows.map(({ id, ...rest }) => rest)
    : rows

  // insert into dev in batches
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH)
    const { error } = await dev.from(name).insert(batch)
    if (error) throw new Error(`insert error at ${i}: ${error.message}`)
    process.stdout.write(`\r  ${name}: inserted ${Math.min(i + BATCH, toInsert.length)}/${toInsert.length}   `)
  }

  process.stdout.write(`\r  ${name}: done (${rows.length} rows)\n`)
}

async function main() {
  console.log('=== Sync Production → Dev ===\n')
  let ok = 0, fail = 0
  for (const t of TABLES) {
    try {
      await syncTable(t)
      ok++
    } catch (e) {
      console.error(`\n  ERROR [${t}]: ${e.message}`)
      fail++
    }
  }
  console.log(`\n=== Done: ${ok} ok, ${fail} failed ===`)
}

main()
