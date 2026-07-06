import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getDevClient(): SupabaseClient | null {
  if (!process.env.DEV_SYNC_SUPABASE_URL || !process.env.DEV_SYNC_SUPABASE_ANON_KEY) return null
  if (!_client) {
    _client = createClient(process.env.DEV_SYNC_SUPABASE_URL, process.env.DEV_SYNC_SUPABASE_ANON_KEY)
  }
  return _client
}

export async function syncToDevAwaited(fn: (db: SupabaseClient) => Promise<void>): Promise<void> {
  const client = getDevClient()
  if (!client) return
  try {
    await fn(client)
  } catch (e: unknown) {
    console.error('[sync-to-dev]', e instanceof Error ? e.message : e)
  }
}

// Syncs one upload batch to dev. Generates UUID client-side so no SELECT
// permission on upload_log is needed (avoids RLS issues on dev Supabase).
export async function syncUploadToDev(
  tableName: string,
  sourceFile: string,
  records: Record<string, unknown>[],
  replaceExisting = false,
): Promise<void> {
  await syncToDevAwaited(async (dev) => {
    // Snapshot tables (e.g. stock_*) replace rather than accumulate — clear
    // previous batches for this table before inserting the new one so dev
    // totals don't double-count. Log-style tables (orders, plans, ...) keep
    // full history and must not pass replaceExisting.
    if (replaceExisting) {
      await dev.from('upload_log').delete().eq('table_name', tableName)
    }

    const uploadLogId = crypto.randomUUID()
    const { error: logErr } = await dev.from('upload_log').insert({
      id: uploadLogId,
      table_name: tableName,
      source_file: sourceFile,
      record_count: records.length,
    })
    if (logErr) throw logErr
    await batchInsert(dev, tableName, records.map(r => ({ ...r, upload_log_id: uploadLogId })))
  })
}

// Batch-insert helper (Supabase caps at 1000 rows per request)
export async function batchInsert(
  db: SupabaseClient,
  table: string,
  rows: unknown[],
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db.from(table).insert(rows.slice(i, i + size))
    if (error) throw error
  }
}
