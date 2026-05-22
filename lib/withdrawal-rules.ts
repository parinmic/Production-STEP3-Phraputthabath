export interface RawMaterialRule {
  productGroup: string; // กลุ่มสินค้า
  type: string;         // ประเภท
  d16: string;          // D16
  d17: string;          // D17
}

export interface LotInfo {
  spec_code: string
  factory: string
  prod_date: string
  available: number
  to_withdraw: number
  insufficient?: boolean
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
  // Remove leading "กลุ่ม" or "กลุ่มเนื้อ"
  return groupName.replace(/^กลุ่ม(เนื้อ)?/, '').trim();
}

export function getLotType(raw_name: string, spec_code: string, rules: RawMaterialRule[]): string {
  if (!raw_name || !spec_code) return 'RAW';
  
  // Extract Digit 16 (index 15) and Digit 17 (index 16)
  const d16Char = (spec_code[15] ?? '').trim().toUpperCase();
  const d17Char = (spec_code[16] ?? '').trim().toUpperCase();
  
  const rawNameClean = raw_name.trim().toLowerCase();
  
  for (const rule of rules) {
    const groupClean = cleanGroupName(rule.productGroup).toLowerCase();
    if (!groupClean) continue;
    
    if (rawNameClean.includes(groupClean)) {
      const ruleD16 = rule.d16.trim().toUpperCase();
      const ruleD17 = rule.d17.trim().toUpperCase();
      
      if (ruleD16 === d16Char && ruleD17 === d17Char) {
        return rule.type.trim() || 'RAW';
      }
    }
  }
  
  return 'RAW';
}

export function allocateFIFOWithRules(
  raw_name: string,
  lots: LotEntry[],
  forProducts: ForProduct[],
  rules: RawMaterialRule[]
): LotInfo[] {
  const result: LotInfo[] = []
  
  // 1. Prepare requirements
  const requirements = forProducts.map(p => ({
    sku: p.sku,
    sku_name: p.sku_name ?? '',
    remainingQty: p.rawQty,
  }));
  
  // Track allocations per lot: lot index -> total allocated in this round
  const allocations = new Map<number, number>();
  
  // To keep track of initial weights before allocation in this round
  const initialWeights = lots.map(l => l.weight);

  // Pre-calculate the type for each lot
  const lotTypes = lots.map(l => getLotType(raw_name, l.spec_code, rules));

  // PASS 1: Allocate restricted lots to matching restricted requirements
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const lotType = lotTypes[i];
    
    if (lotType === 'RAW' || lot.weight <= 0.005) {
      continue;
    }
    
    const typeUpper = lotType.toUpperCase();
    for (const req of requirements) {
      if (req.remainingQty <= 0.005) continue;
      
      // Does req.sku_name contain the lotType keyword?
      if (req.sku_name.toUpperCase().includes(typeUpper)) {
        const take = Math.min(lot.weight, req.remainingQty);
        if (take > 0) {
          lot.weight -= take;
          req.remainingQty -= take;
          allocations.set(i, (allocations.get(i) ?? 0) + take);
        }
      }
      if (lot.weight <= 0.005) break;
    }
  }

  // PASS 2: Allocate normal lots ('RAW') to any remaining requirements
  for (let i = 0; i < lots.length; i++) {
    const lot = lots[i];
    const lotType = lotTypes[i];
    
    if (lotType !== 'RAW' || lot.weight <= 0.005) {
      continue;
    }
    
    for (const req of requirements) {
      if (req.remainingQty <= 0.005) continue;
      
      const take = Math.min(lot.weight, req.remainingQty);
      if (take > 0) {
        lot.weight -= take;
        req.remainingQty -= take;
        allocations.set(i, (allocations.get(i) ?? 0) + take);
      }
      if (lot.weight <= 0.005) break;
    }
  }

  // 2. Build result from allocations
  for (let i = 0; i < lots.length; i++) {
    const allocated = allocations.get(i) ?? 0;
    if (allocated <= 0.005) continue;
    
    const lot = lots[i];
    result.push({
      spec_code:   lot.spec_code,
      factory:     lot.factory,
      prod_date:   lot.prod_date,
      available:   Math.round(initialWeights[i] * 100) / 100,
      to_withdraw: Math.round(allocated * 100) / 100,
    });
  }

  // Check if there are any unsatisfied requirements
  let remainingNeeded = 0;
  for (const req of requirements) {
    if (req.remainingQty > 0.005) {
      remainingNeeded += req.remainingQty;
    }
  }

  if (remainingNeeded > 0.005) {
    result.push({
      spec_code:   '— ไม่เพียงพอ —',
      factory:     '-',
      prod_date:   '-',
      available:   0,
      to_withdraw: Math.round(remainingNeeded * 100) / 100,
      insufficient: true,
    });
  }

  return result;
}
