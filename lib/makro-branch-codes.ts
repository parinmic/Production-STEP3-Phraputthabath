// Mapping: rCv_code (จากไฟล์ export ของ Makro) -> ชื่อสาขาที่จะแสดงผล
// seed มาจากตัวอย่าง mk.csv (ข้อมูลวันเดียว) — เจอสาขาใหม่เพิ่มเข้ามาตามการใช้งานจริง
export const MAKRO_BRANCH_CODES: Record<string, string> = {
  '1A53003900': 'MAKRO 0038 สระบุรี',
  '1A53004800': 'MAKRO 0047 ลพบุรี',
  '1A53005200': 'MAKRO 0051 อยุธยา',
  '1A53008300': 'MAKRO 0082 นครนายก',
  '1A53008400': 'MAKRO 0083 นครอินทร์',
  '1A53009300': 'MAKRO 0096 ทาวน์ อิน ทาวน์',
  '1A53010800': 'MAKRO 0114 สิงห์บุรี',
  '1A53017200': 'MAKRO 0164 สาขาชัยนาท',
}

export function mapMakroBranch(code: string | null): string | null {
  if (!code) return null
  return MAKRO_BRANCH_CODES[code] ?? code
}
