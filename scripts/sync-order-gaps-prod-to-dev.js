const { createClient } = require('@supabase/supabase-js')

const PROD_URL = 'https://jtjironqszdfsflvdvld.supabase.co'
const PROD_KEY = 'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
const DEV_URL = 'https://hmcppjhjybqmlxhdbmbh.supabase.co'
const DEV_KEY = 'sb_publishable_f1cEeDCEH6m2NjkiJlJclQ_zle7sXnI'

const prod = createClient(PROD_URL, PROD_KEY)
const dev = createClient(DEV_URL, DEV_KEY)
const BATCH = 500

async function countRows(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table} count: ${error.message}`)
  return count || 0
}

async function fetchAll(client, table, columns = '*') {
  const count = await countRows(client, table)
  const rows = []
  for (let from = 0; from < count; from += BATCH) {
    const { data, error } = await client.from(table).select(columns).range(from, from + BATCH - 1)
    if (error) throw new Error(`${table} read ${from}: ${error.message}`)
    rows.push(...data)
  }
  return rows
}

async function insertBatches(client, table, rows) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await client.from(table).insert(batch)
    if (error) throw new Error(`${table} insert ${i}: ${error.message}`)
    inserted += batch.length
  }
  return inserted
}

async function fetchLogsByIds(ids) {
  const rows = []
  const idList = Array.from(ids).filter(Boolean)
  for (let i = 0; i < idList.length; i += BATCH) {
    const batch = idList.slice(i, i + BATCH)
    const { data, error } = await prod.from('upload_log').select('*').in('id', batch)
    if (error) throw new Error(`upload_log read: ${error.message}`)
    rows.push(...data)
  }
  return rows
}

async function syncMissingUploadLogs(tableNames) {
  const devLogs = await fetchAll(dev, 'upload_log', 'id')
  const devLogIds = new Set(devLogs.map((row) => row.id))
  let inserted = 0

  for (const tableName of tableNames) {
    const { data, error } = await prod
      .from('upload_log')
      .select('*')
      .eq('table_name', tableName)
    if (error) throw new Error(`upload_log ${tableName} read: ${error.message}`)

    const missingLogs = (data || []).filter((row) => !devLogIds.has(row.id))
    if (missingLogs.length) {
      inserted += await insertBatches(dev, 'upload_log', missingLogs)
      for (const row of missingLogs) devLogIds.add(row.id)
    }
    console.log(`upload_log ${tableName}: inserted ${missingLogs.length}`)
  }

  return inserted
}

async function syncMissingOrderTable(table) {
  const prodCount = await countRows(prod, table)
  const devCount = await countRows(dev, table)
  console.log(`${table}: prod=${prodCount} dev=${devCount}`)

  const devRows = await fetchAll(dev, table, 'id')
  const devIds = new Set(devRows.map((row) => row.id))
  const prodRows = await fetchAll(prod, table)
  const missingRows = prodRows.filter((row) => !devIds.has(row.id))

  if (missingRows.length === 0) {
    console.log(`${table}: already in sync`)
    return
  }

  const missingLogIds = new Set(missingRows.map((row) => row.upload_log_id).filter(Boolean))
  const devLogs = await fetchAll(dev, 'upload_log', 'id')
  const devLogIds = new Set(devLogs.map((row) => row.id))
  const logsToInsert = (await fetchLogsByIds(missingLogIds)).filter((row) => !devLogIds.has(row.id))

  if (logsToInsert.length) {
    const insertedLogs = await insertBatches(dev, 'upload_log', logsToInsert)
    console.log(`${table}: inserted ${insertedLogs} upload_log rows`)
  }

  const insertedOrders = await insertBatches(dev, table, missingRows)
  console.log(`${table}: inserted ${insertedOrders} missing rows`)
}

async function main() {
  await syncMissingUploadLogs([
    'lotus_orders_1400',
    'lotus_orders_1600',
    'wet_market_orders_1400',
    'wet_market_orders_1600',
  ])

  for (const table of ['lotus_orders', 'wet_market_orders']) {
    await syncMissingOrderTable(table)
  }
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
