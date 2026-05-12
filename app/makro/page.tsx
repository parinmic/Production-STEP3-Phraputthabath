'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseMakroFile } from '@/lib/parser'

function makeUpload(round: string) {
  return async (rows: ParsedRow[], filename: string) => {
    const res = await fetch(`/api/upload-makro?round=${round}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename, round }),
    })
    return res.json()
  }
}

export default function MakroPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">อัพโหลดคำสั่งซื้อ Makro</h1>
        <p className="text-gray-500 mt-1">อัพโหลดไฟล์ CSV จากระบบ Makro โดยตรง (รองรับ encoding TIS-620)</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="border-t-4 border-blue-500 pt-4 rounded-t-sm">
          <FileUpload
            title="รอบ 8.00 น."
            description="อัพโหลดคำสั่งซื้อรอบเช้า"
            historyEndpoint="/api/upload-makro?round=0800"
            onUpload={makeUpload('0800')}
            parseFileFn={parseMakroFile}
          />
        </div>
        <div className="border-t-4 border-orange-500 pt-4 rounded-t-sm">
          <FileUpload
            title="รอบ 13.00 น."
            description="อัพโหลดคำสั่งซื้อรอบบ่าย"
            historyEndpoint="/api/upload-makro?round=1300"
            onUpload={makeUpload('1300')}
            parseFileFn={parseMakroFile}
          />
        </div>
      </div>
    </div>
  )
}
