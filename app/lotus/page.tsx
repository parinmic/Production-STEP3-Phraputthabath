'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseLotusWetMarketFile } from '@/lib/parser'

const CHUNK = 400

function makeUpload(round: string) {
  return async (rows: ParsedRow[], filename: string) => {
    const chunks: ParsedRow[][] = []
    for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK))

    let last = { success: false, message: '' }
    for (let i = 0; i < chunks.length; i++) {
      const res = await fetch(`/api/upload-lotus?round=${round}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: chunks[i], filename, round, append: i > 0 }),
      })
      if (!res.ok && !res.headers.get('content-type')?.includes('json')) {
        return { success: false, message: `ไฟล์ใหญ่เกินไป (${rows.length} รายการ) — กรุณาตรวจสอบ` }
      }
      last = await res.json()
      if (!last.success) return last
    }
    return { ...last, message: `บันทึกสำเร็จ ${rows.length} รายการ` }
  }
}

export default function LotusPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">อัพโหลดคำสั่งซื้อ LOTUS</h1>
        <p className="text-gray-500 mt-1">อัพโหลดไฟล์ CSV คำสั่งซื้อจากช่องทาง LOTUS</p>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="border-t-4 border-orange-500 pt-4 rounded-t-sm">
          <FileUpload
            title="รอบ 14.00 น."
            description="อัพโหลดคำสั่งซื้อรอบบ่าย"
            historyEndpoint="/api/upload-lotus?round=1400"
            onUpload={makeUpload('1400')}
            parseFileFn={parseLotusWetMarketFile}
          />
        </div>
        <div className="border-t-4 border-green-500 pt-4 rounded-t-sm">
          <FileUpload
            title="รอบ 16.00 น."
            description="ใช้เป็นข้อมูลย้อนหลัง 3 วัน (BL3) สำหรับคำนวณ Phase 1"
            historyEndpoint="/api/upload-lotus?round=1600"
            onUpload={makeUpload('1600')}
            parseFileFn={parseLotusWetMarketFile}
          />
        </div>
      </div>
    </div>
  )
}
