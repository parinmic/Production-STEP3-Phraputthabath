export interface RawMaterialRule {
  productGroup: string; // กลุ่มสินค้า
  type: string;         // ประเภท
  d16: string;          // D16
  d17: string;          // D17
}

export interface SpecialRawRule {
  product_group: string
  station: string
  d16: string | null
  d17: string | null
}

export interface LotInfo {
  spec_code: string
  factory: string
  prod_date: string
  available: number
  to_withdraw: number
  insufficient?: boolean
  special_remark?: string  // e.g. "D16=K D17=B" when lot matched via mas_special_raw
}

export interface LotEntry {
  spec_code: string
  weight: number
  factory: string
  prod_date: string
  sortKey: string
}

export interface ForProduct {
  sku: string
  sku_name: string | null
  qty: number // finQty
  rawQty: number // rawQty
}

export function cleanGroupName(groupName: string): string {
  return groupName.replace(/^กลุ่ม(เนื้อ)?/, '').trim();
}

// Normalize station name for matching: strip "พิเศษ" suffix
function normalizeStation(s: string): string {
  return s.replace(/พิเศษ$/, '').trim()
}

// Check if a spec_code matches a SpecialRawRule's D16/D17 conditions
// D16 = 1-indexed position 16 = index 15; D17 = index 16
function lotMatchesSpecialRule(spec_code: string, rule: SpecialRawRule): boolean {
  const d16 = rule.d16?.trim()
  const d17 = rule.d17?.trim()
  if (!d16) return false
  if (spec_code.length < 16) return false
  if (spec_code[15] !== d16) return false
  if (d17 && (spec_code.length < 17 || spec_code[16] !== d17)) return false
  return true
}

// Find applicable SpecialRawRule for a given raw material + station
export function findSpecialRawRule(
  raw_name: string,
  station: string,
  specialRawRules: SpecialRawRule[],
): SpecialRawRule | null {
  const normStation = normalizeStation(station)
  for (const rule of specialRawRules) {
    const ruleGroupClean = cleanGroupName(rule.product_group)
    const ruleStationNorm = normalizeStation(rule.station)
    const groupMatches   = raw_name.includes(ruleGroupClean)
    const stationMatches = normStation === ruleStationNorm || station === rule.station
    if (groupMatches && stationMatches) return rule
  }
  return null
}

export function getLotType(raw_name: string, spec_code: string, rules: RawMaterialRule[]): string {
  // Mas Raw Material rules are disabled: always return 'RAW'
  return 'RAW';
}

export function allocateFIFOWithRules(
  raw_name: string,
  lots: LotEntry[],
  forProducts: ForProduct[],
  rules: RawMaterialRule[],
  station?: string,
  specialRawRules?: SpecialRawRule[],
): LotInfo[] {
  const result: LotInfo[] = []

  const requirements = forProducts.map(p => ({
    sku: p.sku,
    sku_name: p.sku_name ?? '',
    remainingQty: p.rawQty,
  }));

  const totalNeeded = requirements.reduce((s, r) => s + r.remainingQty, 0)
  let remaining = totalNeeded

  // ── Special Raw pass: prioritize lots matching D16/D17 rule ─────────────
  const activeRule = (station && specialRawRules?.length)
    ? findSpecialRawRule(raw_name, station, specialRawRules)
    : null

  if (activeRule) {
    const specialLots  = lots.filter(l => l.weight > 0.005 && lotMatchesSpecialRule(l.spec_code, activeRule))
    const remarkStr    = [activeRule.d16, activeRule.d17].filter(Boolean).join('')

    for (const lot of specialLots) {
      if (remaining <= 0.005) break
      const take = Math.min(remaining, lot.weight)
      result.push({
        spec_code:      lot.spec_code,
        factory:        lot.factory,
        prod_date:      lot.prod_date,
        available:      Math.round(lot.weight * 100) / 100,
        to_withdraw:    Math.round(take * 100) / 100,
        special_remark: remarkStr,
      })
      lot.weight -= take
      remaining  -= take
    }
  }

  // ── Normal FIFO pass: oldest lot first ──────────────────────────────────
  for (const lot of lots) {
    if (remaining <= 0.005) break
    if (lot.weight <= 0.005) continue
    const take = Math.min(remaining, lot.weight)
    result.push({
      spec_code:   lot.spec_code,
      factory:     lot.factory,
      prod_date:   lot.prod_date,
      available:   Math.round(lot.weight * 100) / 100,
      to_withdraw: Math.round(take * 100) / 100,
    })
    lot.weight -= take
    remaining  -= take
  }

  if (remaining > 0.005) {
    result.push({
      spec_code:   '— ไม่เพียงพอ —',
      factory:     '-',
      prod_date:   '-',
      available:   0,
      to_withdraw: Math.round(remaining * 100) / 100,
      insufficient: true,
    })
  }

  return result;
}
