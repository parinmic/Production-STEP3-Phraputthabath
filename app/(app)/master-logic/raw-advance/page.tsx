'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-mas-raw-advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MasRawAdvancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mas ผลิต Raw ล่วงหน้า</h1>
        <p className="text-gray-500 mt-1">กำหนดรายการ FG ที่ใช้ในการคำนวณปริมาณ Raw ที่ต้องผลิตล่วงหน้าในแต่ละสายพาน</p>
      </div>

      <div className="card text-sm text-gray-600 space-y-1">
        <p className="font-medium text-gray-700 mb-2">คอลัมน์ที่ต้องการในไฟล์ Excel:</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
          <span><span className="font-semibold text-gray-800">Col 1</span> — สายพาน</span>
          <span><span className="font-semibold text-gray-800">Col 2</span> — เวลาเริ่มผลิต</span>
          <span><span className="font-semibold text-gray-800">Col 3</span> — SAP FG</span>
          <span><span className="font-semibold text-gray-800">Col 4</span> — ชื่อ FG</span>
          <span><span className="font-semibold text-gray-800">Col 5</span> — SAP Raw</span>
          <span><span className="font-semibold text-gray-800">Col 6</span> — ชื่อ Raw</span>
        </div>
        <p className="text-xs text-gray-400 pt-1">ปริมาณ Raw = AVG order ย้อนหลัง 7 วัน × 98% (yield) × 60%</p>
      </div>

      <div className="border-t-4 border-orange-500 pt-4 rounded-t-sm">
        <FileUpload
          title="Mas ผลิต Raw ล่วงหน้า"
          description="อัพโหลดไฟล์ Master (.xlsx / .xls / .csv)"
          historyEndpoint="/api/upload-mas-raw-advance"
          onUpload={upload}
          downloadTable="mas_raw_production_advance"
          menuKey="10.2"
        />
      </div>
    </div>
  )
}
