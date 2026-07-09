// วันผลิต (production day) ของฝั่ง Special: Phase 3 ทำงานต่อเนื่องข้ามเที่ยงคืน
// และต้องจบไม่เกิน 07:00 ของวันถัดไป จึงนับ 00:00–06:59 เป็นของ "เมื่อวาน" ไม่ใช่ "วันนี้"
const BANGKOK_TZ = 'Asia/Bangkok'
const CUTOFF_HOUR = 7

export function productionDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value)

  const dateUTC = new Date(Date.UTC(get('year'), get('month') - 1, get('day')))
  if (get('hour') < CUTOFF_HOUR) dateUTC.setUTCDate(dateUTC.getUTCDate() - 1)
  return dateUTC.toISOString().slice(0, 10)
}
