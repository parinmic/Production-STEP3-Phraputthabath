// Menu-key scheme สำหรับฝั่งพิเศษ (STEP 3) — ตรงกับชีท "Detail" ของไฟล์ "User ระบบผลิต.xlsx"
// menu_key ที่เก็บใน sys_position_menus เป็นเลข (string) ตามหมายเลขในชีท Detail
// หรือ 'all' (เข้าได้ทุกเมนู) — ไม่มีเลขรวมระดับหมวด (เช่นไม่มี "2" หรือ "7" หรือ "10" เดี่ยวๆ)
// ต้องระบุเลขย่อยแต่ละตัวที่อนุญาตทีละตัว

export const SPECIAL_MENU_LABELS: Record<string, string> = {
  '0':    'Dashboard บริหาร',
  '1':    'รายการเบิกสินค้า',
  '2.1':  'คำสั่งผลิต Station สะโพกพิเศษ',
  '2.2':  'คำสั่งผลิต Station สามชั้นพิเศษ',
  '2.3':  'คำสั่งผลิต Station ไหล่พิเศษ',
  '2.4':  'คำสั่งผลิต Station หมูบด',
  '2.5':  'คำสั่งผลิต Station สไลด์',
  '2.6':  'คำสั่งผลิต Station เผาขา',
  '2.7':  'คำสั่งผลิต Station เลาะขา',
  '3':    'แผนการใช้เครื่องเลื่อย',
  '4':    'รายการ Raw รอผลิต',
  '5':    'แผนผลิต WIP',
  '6':    'จัดสรรเนื้อ Raw Mat',
  '7.1':  'คำสั่งซื้อ Makro',
  '7.2':  'คำสั่งซื้อ Lotus',
  '7.3':  'คำสั่งซื้อ Wet Market',
  '7.4':  'คำสั่งซื้อ FS',
  '7.5':  'แผนผลิต 100%',
  '7.6':  'แผนรอบเสริม',
  '8':    'Stock Raw Material',
  '9':    'รับผลได้',
  '10.1': 'Master กำลังคน',
  '10.2': 'Master Calculation',
  '11':   'จัดการแผนผลิต',
  '12':   'User ระบบผลิต',
}

// station slug (ตรงกับ TABLES ใน Sidebar.tsx / production/[table]) → หมายเลขเมนู
export const SPECIAL_STATION_MENU_NUMBER: Record<string, string> = {
  'sa-phok':  '2.1',
  'sam-chan': '2.2',
  'lai':      '2.3',
  'moo-chod': '2.4',
  'slide':    '2.5',
  'pao-kha':  '2.6',
  'loa-kha':  '2.7',
}

export function hasSpecialMenu(menus: string[] | null | undefined, key: string): boolean {
  if (!menus) return true
  return menus.includes('all') || menus.includes(key)
}

export function canAccessSpecialStation(menus: string[] | null | undefined, slug: string): boolean {
  const num = SPECIAL_STATION_MENU_NUMBER[slug]
  if (!num) return false
  return hasSpecialMenu(menus, num)
}
