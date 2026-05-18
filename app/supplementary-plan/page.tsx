'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parsePlan100 } from '@/lib/parser'

async function uploadSupplementaryPlan(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-supplementary-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function SupplementaryPlanPage() {
  return (
    <FileUpload
      title="แผนรอบเสริม"
      description="อัพโหลดไฟล์ Template แผนผลิต — ชีท &quot;แผน 100%&quot; ใช้สำหรับแผนผลิตรอบเสริมนอกเหนือจาก Phase 1–3"
      historyEndpoint="/api/upload-supplementary-plan"
      onUpload={uploadSupplementaryPlan}
      parseFileFn={parsePlan100}
    />
  )
}
