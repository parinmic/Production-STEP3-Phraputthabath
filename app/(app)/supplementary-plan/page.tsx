'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseSupplementaryPlanFile } from '@/lib/parser'
import { Layers } from 'lucide-react'

async function uploadSupplementary(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-supplementary-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function SupplementaryPlanPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Layers className="text-emerald-600" />
          แผนรอบเสริม
        </h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          อัพโหลดไฟล์ Excel ที่มี sheet ชื่อ &quot;แผนรอบเสริม&quot; — ระบบจะอ่านเวลาโหลดจากช่อง D1 วันที่ผลิตจาก H2 และรายการจากคอลัมน์ D (SAP) และ H (น้ำหนักสั่ง)
        </p>
      </div>
      <div className="border-t-4 border-emerald-600 pt-4 rounded-t-sm">
        <FileUpload
          title="อัพโหลดแผนรอบเสริม"
          description='เลือกไฟล์ Excel ที่มี sheet "แผนรอบเสริม" — slot จะถูกกำหนดอัตโนมัติจากเวลาโหลด (≤14:00 = slot 1, ≤16:00 = slot 2, อื่นๆ = slot 3)'
          historyEndpoint="/api/upload-supplementary-plan"
          onUpload={uploadSupplementary}
          parseFileFn={parseSupplementaryPlanFile}
          downloadTable="production_plan_supplementary"
        />
      </div>
    </div>
  )
}
