'use client'
import FileUpload from '@/components/FileUpload'
import GeneratePlanButtonsBySide from '@/components/GeneratePlanButtonsBySide'
import { ParsedRow, parsePlan100 } from '@/lib/parser'

async function uploadPlan100(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-plan100', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function Plan100Page() {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <GeneratePlanButtonsBySide menuKey="7.5" />
      </div>
      <FileUpload
        title="แผนผลิต 100%"
        description="อัพโหลดไฟล์ Template แผนผลิต — ชีท &quot;แผน 100%&quot; ใช้สำหรับคำนวณ Phase 3 = แผน 100% − Phase 1 − Phase 2"
        historyEndpoint="/api/upload-plan100"
        onUpload={uploadPlan100}
        parseFileFn={parsePlan100}
        downloadTable="production_plan_100"
        menuKey="7.5"
      />
    </div>
  )
}
