import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

function getDevClient(): SupabaseClient | null {
  if (!process.env.DEV_SUPABASE_URL || !process.env.DEV_SUPABASE_KEY) return null
  if (!_client) {
    _client = createClient(process.env.DEV_SUPABASE_URL, process.env.DEV_SUPABASE_KEY)
  }
  return _client
}

// Fire-and-forget: mirrors an upload operation to the dev DB.
// Call after a successful production write — never awaited, never throws.
export function syncToDev(fn: (db: SupabaseClient) => Promise<void>): void {
  const client = getDevClient()
  if (!client) return
  fn(client).catch(e => console.error('[sync-to-dev]', e?.message ?? e))
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
