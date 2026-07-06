'use client'
import ManualLayout from '@/components/ManualLayout'
import { specialManualGroups, specialOverview } from '@/lib/manual-content-special'

export default function SpecialManualPage() {
  return (
    <ManualLayout
      title="คู่มือการใช้งานระบบ"
      subtitle="คำอธิบายแต่ละหน้าในระบบฝั่งพิเศษ (STEP 3) สำหรับผู้เพิ่งเริ่มใช้งาน"
      groups={specialManualGroups}
      overview={specialOverview}
    />
  )
}
