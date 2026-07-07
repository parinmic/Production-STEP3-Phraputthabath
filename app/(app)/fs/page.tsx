'use client'
import FileUpload from '@/components/FileUpload'
import GenerateSpecialPlanButtons from '@/components/GenerateSpecialPlanButtons'
import { ParsedRow, parseLotusWetMarketFile } from '@/lib/parser'

async function uploadFsOrders(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-fs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function FsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">อัพโหลดคำสั่งซื้อ FS</h1>
          <p className="text-gray-500 mt-1">อัพโหลดไฟล์คำสั่งซื้อช่องทาง Food Service (rBst_code=924 / rOper_code=4903)</p>
        </div>
        <GenerateSpecialPlanButtons menuKey="7.4" />
      </div>

      <div className="max-w-xl">
        <div className="border-t-4 border-indigo-500 pt-4 rounded-t-sm">
          <FileUpload
            title="คำสั่งซื้อ FS"
            description="อัพโหลดไฟล์คำสั่งซื้อประจำวัน (รอบเดียว — ระบบจะแบ่งผลิตตาม Phase อัตโนมัติ)"
            historyEndpoint="/api/upload-fs"
            onUpload={uploadFsOrders}
            parseFileFn={parseLotusWetMarketFile}
            downloadTable="fs_orders"
            menuKey="7.4"
          />
        </div>
      </div>
    </div>
  )
}
