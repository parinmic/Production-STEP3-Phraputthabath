// วันที่ default ของหน้าจอ/รายงานต่างๆ ("วันนี้") — ใช้กฎ "วันผลิต" เดียวกับ lib/production-day.ts
// (เปลี่ยนวันตอน 04:00 แทนเที่ยงคืน) เพื่อให้ทุกหน้าเห็นวันเดียวกัน
import { productionDay } from './production-day'

export function todayBangkok(): string {
  return productionDay()
}
