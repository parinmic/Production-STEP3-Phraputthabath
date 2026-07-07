'use client'
import WorkforceStatusView from '@/components/WorkforceStatusView'

const STATIONS = [
  { slug: 'สะโพก',  label: 'สะโพกเบสิค' },
  { slug: 'สามชั้น', label: 'สามชั้นเบสิค' },
  { slug: 'ไหล่',    label: 'ไหล่เบสิค' },
]

export default function BasicWorkforceDailyStatusPage() {
  return (
    <WorkforceStatusView
      title="ตรวจสอบสถานะกำลังคน"
      stations={STATIONS}
      note="ตอนนี้ระบบ Sync ข้อมูลกำลังคนอัตโนมัติยังครอบคลุมเฉพาะฝั่งพิเศษ (STEP 3) เท่านั้น — ฝั่งเบสิคจะยังไม่มีข้อมูลแสดงจนกว่าจะเชื่อมข้อมูลกำลังคนฝั่งนี้เพิ่ม"
    />
  )
}
