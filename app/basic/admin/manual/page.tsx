'use client'
import ManualLayout from '@/components/ManualLayout'
import { basicManualGroups, basicOverview } from '@/lib/manual-content-basic'

export default function BasicManualPage() {
  return (
    <ManualLayout
      title="คู่มือการใช้งานระบบ"
      subtitle="คำอธิบายแต่ละหน้าในระบบฝั่งเบสิค (STEP 2) สำหรับผู้เพิ่งเริ่มใช้งาน"
      groups={basicManualGroups}
      overview={basicOverview}
    />
  )
}
