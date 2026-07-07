'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseMooChōdMaster } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-moo-chod-master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MooChōdMasterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Master หมูบด — สัดส่วนไขมัน</h1>
        <p className="text-gray-500 mt-1">
          กำหนด %ไขมัน ต่อ SKU เพื่อคำนวณสัดส่วน เนื้อ : มัน ที่ต้องผสมในการผลิตหมูบด
        </p>
      </div>

      <div className="border-t-4 border-red-500 pt-4 rounded-t-sm">
        <div className="flex items-center gap-2 pb-3 mb-2">
          <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
          <h2 className="text-base font-semibold text-gray-700">Master หมูบด (%ไขมัน)</h2>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          คอลัมน์ที่ต้องการ: <span className="font-medium text-gray-600">จุดงาน, กลุ่มสินค้า, SAP, ชื่อสินค้า, %ไขมัน</span>
        </p>
        <FileUpload
          title=""
          description="อัพโหลดไฟล์ Master หมูบด (.xlsx / .xls / .csv)"
          historyEndpoint="/api/upload-moo-chod-master"
          onUpload={upload}
          parseFileFn={parseMooChōdMaster}
          downloadTable="moo_chod_master"
          menuKey="10.2"
        />
      </div>
    </div>
  )
}
