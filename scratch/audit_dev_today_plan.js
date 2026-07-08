const { createClient } = require('@supabase/supabase-js')

const url = process.env.DEV_SYNC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.DEV_SYNC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const date = process.argv[2] || '2026-07-03'

if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const supabase = createClient(url, key)
const BASIC_STATIONS = ['สะโพกเบสิค', 'สามชั้นเบสิค', 'ไหล่เบสิค']

function normSku(v) {
  return String(v ?? '').trim().replace(/^0+/, '')
}

function normStation(v) {
  return String(v ?? '').trim()
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(v) {
  return Math.round(v * 100) / 100
}

function rowVal(row, names) {
  for (const name of names) {
    if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name]
  }
  return undefined
}

async function fetchAll(table, select, build) {
  const rows = []
  const page = 1000
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(select).range(from, from + page - 1)
    q = build ? build(q) : q
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < page) break
  }
  return rows
}

async function main() {
  const assignments = await fetchAll(
    'production_assignments',
    'id, production_date, table_name, sku, sku_name, target_quantity, worker_name, period, channel, deadline_time, note, effective_from, seq, is_deficit, unit',
    q => q.eq('production_date', date).in('table_name', BASIC_STATIONS)
  )

  const latestKey = new Map()
  for (const r of assignments) {
    const k = `${r.table_name}|||${r.period}`
    const eff = r.effective_from || ''
    if (!latestKey.has(k) || eff > latestKey.get(k)) latestKey.set(k, eff)
  }
  const latest = assignments.filter(r => latestKey.get(`${r.table_name}|||${r.period}`) === (r.effective_from || ''))

  const [
    prodRowsRaw,
    pickRows,
    sayapanRows,
    groupRuleRows,
    wmRows,
    lotusRows,
    makroRows,
    plan100RowsRaw,
    lotSelection,
    masYieldRows,
  ] = await Promise.all([
    fetchAll('master_logic_calculation', 'calculation_type,row_data,uploaded_at', q => q.eq('calculation_type', 'Mas Productivity Basic').order('uploaded_at', { ascending: false })),
    fetchAll('picking_unit_master', 'sap,weight_per_bag'),
    fetchAll('mas_sayapan', 'product_group,station'),
    fetchAll('mas_group_station_rule', 'product_group,station,is_enabled,split_mode,priority,share_pct,allow_same_sku,sku_route_mode,raw_remainder_mode,overflow_station'),
    fetchAll('wet_market_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('lotus_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date).eq('upload_round', '1400')),
    fetchAll('makro_orders', 'sku,sku_name,quantity,delivery_date,upload_round', q => q.eq('delivery_date', date)),
    fetchAll('production_plan_100', 'plan_date,sap,product_name,weight_total,upload_log_id,uploaded_at', q => q.eq('plan_date', date)),
    supabase.from('pig_carcass_lot_selection').select('*').eq('production_date', date).maybeSingle().then(({ data, error }) => {
      if (error) throw new Error(`pig_carcass_lot_selection: ${error.message}`)
      return data || {}
    }),
    fetchAll('mas_yield', 'carcass_weight,product_group,yield_pct,notes'),
  ])

  const latestPlanUpload = plan100RowsRaw.reduce((m, r) => r.uploaded_at && (!m || r.uploaded_at > m) ? r.uploaded_at : m, '')
  const plan100Rows = latestPlanUpload ? plan100RowsRaw.filter(r => r.uploaded_at === latestPlanUpload) : plan100RowsRaw

  const prodBySku = new Map()
  for (const r of prodRowsRaw) {
    const d = r.row_data || {}
    const sku = normSku(rowVal(d, ['SAP', 'sap', 'sku']))
    if (!sku || prodBySku.has(sku)) continue
    prodBySku.set(sku, {
      sku,
      name: String(rowVal(d, ['ชื่อสินค้า', 'sku_name', 'product_name']) ?? '').trim(),
      station: normStation(rowVal(d, ['สถานี', 'station', 'table_name'])),
      group: String(rowVal(d, ['กลุ่มสินค้า', 'product_group']) ?? '').trim(),
      rate: num(rowVal(d, ['ผลิตได้/คน/ชม.', 'rate', 'productivity'])),
    })
  }

  const bagBySku = new Map()
  for (const r of pickRows) {
    const sku = normSku(r.sap)
    if (sku) bagBySku.set(sku, num(r.weight_per_bag))
  }

  const sayapanByGroup = new Map()
  for (const r of sayapanRows) {
    const g = String(r.product_group ?? '').trim()
    const s = normStation(r.station)
    if (!g || !s) continue
    if (!sayapanByGroup.has(g)) sayapanByGroup.set(g, new Set())
    sayapanByGroup.get(g).add(s)
  }

  const rulesByGroup = new Map()
  for (const r of groupRuleRows) {
    if (r.is_enabled === false) continue
    const g = String(r.product_group ?? '').trim()
    const s = normStation(r.station)
    if (!g || !s) continue
    if (!rulesByGroup.has(g)) rulesByGroup.set(g, [])
    rulesByGroup.get(g).push({ ...r, station: s, priority: num(r.priority || 999) })
  }
  for (const list of rulesByGroup.values()) list.sort((a, b) => a.priority - b.priority)

  const sourceBySkuChannel = new Map()
  const addSource = (channel, rows) => {
    for (const r of rows) {
      const sku = normSku(r.sku)
      if (!sku) continue
      const k = `${channel}|||${sku}`
      const cur = sourceBySkuChannel.get(k) || { channel, sku, name: r.sku_name, qty: 0 }
      cur.qty += num(r.quantity)
      sourceBySkuChannel.set(k, cur)
    }
  }
  addSource('Wet Market', wmRows)
  addSource('LOTUS', lotusRows)
  addSource('Makro', makroRows)
  addSource('Plan100', plan100Rows.map(r => ({ sku: r.sap, sku_name: r.product_name, quantity: r.weight_total })))

  const agg = new Map()
  for (const r of latest) {
    const sku = normSku(r.sku)
    if (!sku) continue
    const k = `${r.table_name}|||${r.period}|||${sku}|||${r.channel || ''}|||${r.note || ''}`
    const cur = agg.get(k) || {
      table: r.table_name,
      period: r.period,
      sku,
      name: r.sku_name,
      channel: r.channel || '',
      note: r.note || '',
      qty: 0,
      workers: new Set(),
      rows: 0,
    }
    cur.qty += num(r.target_quantity)
    cur.workers.add(r.worker_name || '')
    cur.rows += 1
    agg.set(k, cur)
  }

  const issues = []
  for (const a of agg.values()) {
    const prod = prodBySku.get(a.sku)
    const isRaw = /raw/i.test(a.name || '') || a.channel === 'RAW' || /raw_remainder/.test(a.note)

    if (!prod) {
      issues.push({ severity: 'HIGH', reason: 'SKU ไม่มีใน Master Productivity Basic', ...a, qty: round2(a.qty), workers: a.workers.size })
      continue
    }

    const allowed = new Set()
    const rules = rulesByGroup.get(prod.group) || []
    if (rules.length) for (const r of rules) allowed.add(r.station)
    else for (const s of (sayapanByGroup.get(prod.group) || [])) allowed.add(s)
    if (allowed.size && !allowed.has(a.table)) {
      issues.push({
        severity: 'HIGH',
        reason: `สถานีไม่ตรง master route/group (${prod.group}); allowed=${Array.from(allowed).join(',')}`,
        ...a,
        masterStation: prod.station,
        qty: round2(a.qty),
        workers: a.workers.size,
      })
    }

    const bag = bagBySku.get(a.sku)
    if (!isRaw && bag && bag > 0) {
      const rem = Math.abs(a.qty / bag - Math.round(a.qty / bag))
      if (rem > 0.001) {
        issues.push({
          severity: 'MED',
          reason: `ยอดรวมไม่ลงหน่วยหยิบ ${bag} กก./ถุง`,
          ...a,
          qty: round2(a.qty),
          workers: a.workers.size,
        })
      }
    }

    if (!isRaw && /round:\d+:/.test(a.note || '')) {
      const sourceKey = `${a.channel}|||${a.sku}`
      const src = sourceBySkuChannel.get(sourceKey)
      if (src && a.qty > src.qty * 1.5 && a.qty - src.qty > 20) {
        issues.push({
          severity: 'MED',
          reason: `ยอดผลิตสูงกว่า source order มาก (${round2(a.qty)} vs ${round2(src.qty)})`,
          ...a,
          sourceQty: round2(src.qty),
          qty: round2(a.qty),
          workers: a.workers.size,
        })
      }
    }
  }

  const bySkuTotal = new Map()
  for (const a of agg.values()) {
    const k = `${a.sku}|||${a.channel}`
    const cur = bySkuTotal.get(k) || { sku: a.sku, name: a.name, channel: a.channel, qty: 0, tables: new Set(), periods: new Set() }
    cur.qty += a.qty
    cur.tables.add(a.table)
    cur.periods.add(a.period)
    bySkuTotal.set(k, cur)
  }
  const huge = Array.from(bySkuTotal.values())
    .filter(r => r.channel !== 'RAW' && r.qty > 0)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 20)

  const uniqueWeights = Array.from(new Set(masYieldRows.map(r => num(r.carcass_weight)))).filter(Boolean).sort((a, b) => a - b)
  const closestWeight = w => uniqueWeights.reduce((best, cur) => Math.abs(cur - w) < Math.abs(best - w) ? cur : best, uniqueWeights[0] || 0)
  const selectedLots = Array.isArray(lotSelection.selected) ? lotSelection.selected : []
  const rate = num(lotSelection.rate) || 90
  const phase1Pigs = Math.floor((300 * 60) / rate)
  let needPigs = phase1Pigs
  const phase1Lots = []
  for (const lot of selectedLots.slice().sort((a, b) => num(a.order) - num(b.order))) {
    if (needPigs <= 0) break
    const take = Math.min(needPigs, num(lot.qty))
    if (take > 0) {
      phase1Lots.push({ qty: take, avg_weight: num(lot.avg_weight), closest_weight: closestWeight(num(lot.avg_weight)) })
      needPigs -= take
    }
  }
  const yieldByGroup = new Map()
  for (const lot of phase1Lots) {
    for (const y of masYieldRows) {
      if (num(y.carcass_weight) !== lot.closest_weight) continue
      const group = String(y.product_group || '').trim()
      if (!group) continue
      yieldByGroup.set(group, (yieldByGroup.get(group) || 0) + lot.qty * lot.avg_weight * num(y.yield_pct) / 100)
    }
  }

  const assignedByGroup = new Map()
  for (const a of bySkuTotal.values()) {
    const prod = prodBySku.get(a.sku)
    const group = prod?.group || ''
    if (!group) continue
    assignedByGroup.set(group, (assignedByGroup.get(group) || 0) + a.qty)
  }
  const groupYieldCheck = Array.from(new Set([...yieldByGroup.keys(), ...assignedByGroup.keys()]))
    .map(group => ({
      group,
      yieldKg: round2(yieldByGroup.get(group) || 0),
      assignedKg: round2(assignedByGroup.get(group) || 0),
      diffKg: round2((assignedByGroup.get(group) || 0) - (yieldByGroup.get(group) || 0)),
    }))
    .filter(r => r.yieldKg || r.assignedKg)
    .sort((a, b) => Math.abs(b.diffKg) - Math.abs(a.diffKg))

  console.log(JSON.stringify({
    date,
    source: url,
    assignmentRows: assignments.length,
    latestRows: latest.length,
    latestBatches: Object.fromEntries(latestKey),
    master: {
      productivitySkus: prodBySku.size,
      pickingUnitSkus: bagBySku.size,
      groupRules: rulesByGroup.size,
      plan100Rows: plan100Rows.length,
      plan100LatestUpload: latestPlanUpload || null,
    },
    issueCount: issues.length,
    issues: issues
      .sort((a, b) => (a.severity === b.severity ? b.qty - a.qty : a.severity === 'HIGH' ? -1 : 1))
      .slice(0, 80)
      .map(x => ({ ...x, workers: x.workers instanceof Set ? x.workers.size : x.workers })),
    topPlannedNonRaw: huge.map(r => ({ ...r, qty: round2(r.qty), tables: Array.from(r.tables), periods: Array.from(r.periods) })),
    carcassYield: {
      rate,
      phase1Pigs,
      selectedLots: phase1Lots,
      groupYieldCheck,
    },
  }, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
