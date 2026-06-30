import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getDevClient(): SupabaseClient | null {
  if (!process.env.DEV_SYNC_SUPABASE_URL || !process.env.DEV_SYNC_SUPABASE_ANON_KEY) return null
  if (!_client) {
    _client = createClient(process.env.DEV_SYNC_SUPABASE_URL, process.env.DEV_SYNC_SUPABASE_ANON_KEY)
  }
  return _client
}

// Fire-and-forget (used by most upload routes).
export function syncToDev(fn: (db: SupabaseClient) => Promise<void>): void {
  const client = getDevClient()
  if (!client) return
  fn(client).catch(e => console.error('[sync-to-dev]', e?.message ?? e))
}

// Awaited version — use when you need the sync to complete before returning the
// response.  Errors are caught and logged; the caller is never rejected.
export async function syncToDevAwaited(fn: (db: SupabaseClient) => Promise<void>): Promise<void> {
  const client = getDevClient()
  if (!client) return
  try {
    await fn(client)
  } catch (e: unknown) {
    console.error('[sync-to-dev]', e instanceof Error ? e.message : e)
  }
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
