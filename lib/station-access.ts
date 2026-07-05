// จำกัดสิทธิ์ระดับ Station ภายในเมนู "คำสั่งผลิตราย Station"
// menu_key รูปแบบ `station:<slug>` ใน sys_position_menus บอกว่า position นั้น
// เห็น/เข้าได้เฉพาะ station ที่ระบุ — ถ้าไม่มี key แบบนี้เลย (backward-compatible)
// จะยังเห็นได้ทุก station เหมือนเดิม ตราบใดที่มี menu key 'production' หรือ 'all'

export const SPECIAL_STATION_SLUGS = ['sam-chan', 'sa-phok', 'lai', 'moo-chod', 'slide', 'pao-kha', 'loa-kha'] as const
export const BASIC_STATION_SLUGS = ['sa-phok-basic', 'lai-basic', 'sam-chan-basic'] as const

// table_name (label ที่เก็บใน production_assignments) → station slug
export const STATION_LABEL_TO_SLUG: Record<string, string> = {
  'สามชั้น': 'sam-chan',
  'สะโพก': 'sa-phok',
  'ไหล่': 'lai',
  'หมูบด': 'moo-chod',
  'สไลด์': 'slide',
  'เผาขา': 'pao-kha',
  'เลาะขา': 'loa-kha',
  'สะโพกเบสิค': 'sa-phok-basic',
  'ไหล่เบสิค': 'lai-basic',
  'สามชั้นเบสิค': 'sam-chan-basic',
}

const stationKeyPrefix = 'station:'

export function canAccessStation(menus: string[] | null | undefined, slug: string): boolean {
  if (!menus) return true // ไม่มี session — ปล่อยผ่าน (เหมือน logic เดิมของ has())
  if (menus.includes('all')) return true
  if (!menus.includes('production')) return false

  const stationKeys = menus.filter((m) => m.startsWith(stationKeyPrefix))
  if (stationKeys.length === 0) return true // ไม่มีการระบุ station เจาะจง — เห็นได้ทุก station เหมือนเดิม

  return stationKeys.includes(`${stationKeyPrefix}${slug}`)
}
