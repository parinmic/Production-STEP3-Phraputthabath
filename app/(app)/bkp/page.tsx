'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseBKPFile } from '@/lib/parser'

async function uploadBKP(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-bkp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function BKPPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">อัพโหลดคำสั่งซื้อ BKP</h1>
        <p className="text-gray-500 mt-1">อัพโหลดแผนผลิตสินค้าสำหรับช่องทาง BKP — จุดงาน ไหล่พิเศษ</p>
      </div>
      <div className="border-t-4 border-indigo-500 pt-4 rounded-t-sm">
        <FileUpload
          title="คำสั่งซื้อ BKP"
          description="อัพโหลดไฟล์ Excel BKP — แถวที่ 2 = รายการสินค้า (SAP 8 หลัก), Column C = วันที่ส่งถึง, Column แผน = ปริมาณ"
          historyEndpoint="/api/upload-bkp"
          onUpload={uploadBKP}
          parseFileFn={parseBKPFile}
          downloadTable="bkp_orders"
        />
      </div>
    </div>
  )
}
