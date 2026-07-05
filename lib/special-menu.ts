// Menu-key scheme ตรงกับชีท "Detail" ของไฟล์ "User ระบบผลิต.xlsx" — ใช้ร่วมกันทั้งฝั่ง
// พิเศษ (STEP 3) และเบสิค (STEP 2) เพราะ user คนหนึ่งเห็นแค่ sidebar เดียวตาม step ของตัวเอง
// menu_key ที่เก็บใน sys_position_menus เป็นเลข (string) ตามหมายเลขในชีท Detail หรือ 'all'
// (เข้าได้ทุกเมนู) — ไม่มีเลขรวมระดับหมวด (เช่นไม่มี "2" หรือ "7" หรือ "10" เดี่ยวๆ)
// ต้องระบุเลขย่อยแต่ละตัวที่อนุญาตทีละตัว เลขบางตัว (เช่น 4, 8) ใช้ร่วมกันทั้งสอง step
// เพราะเป็นแนวคิดเดียวกัน (รายการ Raw รอผลิต / Stock Raw Material) แค่คนละหน้า/route

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
  '13':   'ตรวจอุณหภูมิ(QC)',
  '14':   'เบิกหมูซีก',
  '15.1': 'คำสั่งผลิต Station สะโพกเบสิค',
  '15.2': 'คำสั่งผลิต Station สามชั้นเบสิค',
  '15.3': 'คำสั่งผลิต Station ไหล่เบสิค',
  '16':   'Breakline',
  '17':   'รอบการลงหมูซีก',
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

// station slug (ตรงกับ BASIC_STATIONS ใน BasicSidebar.tsx / basic/production/[table]) → หมายเลขเมนู
export const BASIC_STATION_MENU_NUMBER: Record<string, string> = {
  'sa-phok-basic':  '15.1',
  'sam-chan-basic': '15.2',
  'lai-basic':      '15.3',
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

export function canAccessBasicStation(menus: string[] | null | undefined, slug: string): boolean {
  const num = BASIC_STATION_MENU_NUMBER[slug]
  if (!num) return false
  return hasSpecialMenu(menus, num)
}
