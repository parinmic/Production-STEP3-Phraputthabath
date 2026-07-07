'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseMooChōdWithdrawalMaster } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-moo-chod-withdrawal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MooChōdWithdrawalPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Master เบิกของสำหรับหมูบด</h1>
        <p className="text-gray-500 mt-1">
          กำหนด priority การเบิกวัตถุดิบแยกกลุ่ม เนื้อ และ มัน — ระบบจะเบิกตาม priority ก่อนเสมอ
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">รูปแบบไฟล์ที่รองรับ (.xlsx / .xls)</p>
        <p>ไฟล์ต้องมี 2 กลุ่มเคียงกัน:</p>
        <div className="mt-2 flex gap-8">
          <div>
            <p className="font-medium">กลุ่มเนื้อ (ซ้าย)</p>
            <p className="text-xs text-amber-700">Priority | Sap เนื้อ | ชื่อเนื้อ | %ไขมัน</p>
          </div>
          <div>
            <p className="font-medium">กลุ่มมัน (ขวา)</p>
            <p className="text-xs text-amber-700">Priority | Sap มัน | ชื่อมัน | %ไขมัน</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-amber-600">Priority 1 = เบิกก่อน, ระบบจะเบิกจนหมดก่อนไป Priority ถัดไป</p>
      </div>

      <div className="border-t-4 border-red-500 pt-4 rounded-t-sm">
        <div className="flex items-center gap-2 pb-3 mb-2">
          <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
          <h2 className="text-base font-semibold text-gray-700">Master เบิกหมูบด (เนื้อ + มัน)</h2>
        </div>
        <FileUpload
          title=""
          description="อัพโหลดไฟล์ Master เบิกของหมูบด (.xlsx / .xls)"
          historyEndpoint="/api/upload-moo-chod-withdrawal"
          onUpload={upload}
          parseFileFn={parseMooChōdWithdrawalMaster}
          downloadTable="moo_chod_withdrawal_master"
          menuKey="10.2"
        />
      </div>
    </div>
  )
}
