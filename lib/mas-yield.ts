import type { SupabaseClient } from '@supabase/supabase-js'

export type MasYieldRow = {
  carcass_weight: number
  product_group: string
  yield_pct: number
  notes?: string | null
  upload_log_id?: string | null
}

async function fetchPaged<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  apply: (query: any) => any = query => query,
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0

  while (true) {
    const query = apply(supabase.from(table).select(select)).range(from, from + PAGE - 1)
    const { data, error } = await query
    if (error) throw error
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  return all
}

export async function fetchLatestMasYield(supabase: SupabaseClient): Promise<MasYieldRow[]> {
  const { data: latestLog, error: logError } = await supabase
    .from('upload_log')
    .select('id')
    .eq('table_name', 'mas_yield')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logError) throw logError

  const select = 'carcass_weight, product_group, yield_pct, notes, upload_log_id'
  if (latestLog?.id) {
    const latestRows = await fetchPaged<MasYieldRow>(
      supabase,
      'mas_yield',
      select,
      query => query.eq('upload_log_id', latestLog.id)
        .order('carcass_weight', { ascending: true })
        .order('product_group', { ascending: true }),
    )
    if (latestRows.length > 0) return latestRows
  }

  const rows = await fetchPaged<MasYieldRow>(
    supabase,
    'mas_yield',
    select,
    query => query.order('carcass_weight', { ascending: true }).order('product_group', { ascending: true }),
  )

  const latestByKey = new Map<string, MasYieldRow>()
  for (const row of rows) {
    const key = `${row.carcass_weight}|||${row.product_group}`
    latestByKey.set(key, row)
  }
  return Array.from(latestByKey.values())
}
