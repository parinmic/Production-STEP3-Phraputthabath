'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseLotusWetMarketFile } from '@/lib/parser'
import { uploadWetMarketOrders } from '@/lib/upload-orders'

function makeUpload(round: string) {
  return (rows: ParsedRow[], filename: string) => uploadWetMarketOrders(rows, filename, round)
}

export default function WetMarketPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">อัพโหลดคำสั่งซื้อ Wet Market</h1>
        <p className="text-gray-500 mt-1">อัพโหลดไฟล์ CSV คำสั่งซื้อจากช่องทาง Wet Market</p>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="border-t-4 border-teal-500 pt-4 rounded-t-sm">
          <FileUpload
            title="รอบ 14.00 น."
            description="อัพโหลดคำสั่งซื้อรอบบ่าย"
            historyEndpoint="/api/upload-wet-market?round=1400"
            onUpload={makeUpload('1400')}
            parseFileFn={parseLotusWetMarketFile}
          />
        </div>
        <div className="border-t-4 border-orange-500 pt-4 rounded-t-sm">
          <FileUpload
            title="รอบ 16.00 น."
            description="ใช้เป็นข้อมูลย้อนหลัง 3 วัน (BL3) สำหรับคำนวณ Phase 1"
            historyEndpoint="/api/upload-wet-market?round=1600"
            onUpload={makeUpload('1600')}
            parseFileFn={parseLotusWetMarketFile}
          />
        </div>
      </div>
    </div>
  )
}
