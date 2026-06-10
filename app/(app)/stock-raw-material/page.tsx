'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow, parseStockRawMaterial } from '@/lib/parser'

async function uploadStock0010(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-stock-0010', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

async function uploadStock20(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-stock-20', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function StockRawMaterialPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stock Raw Material</h1>
        <p className="text-gray-500 mt-1">อัพโหลดข้อมูล Stock วัตถุดิบ — ต้องอัพโหลด 2 ไฟล์</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="border-t-4 border-blue-500 pt-4 rounded-t-sm">
          <div className="flex items-center gap-2 pb-3 mb-2">
            <span className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
            <h2 className="text-base font-semibold text-gray-700">ไฟล์ STOCK 0010</h2>
          </div>
          <FileUpload
            title=""
            description="อัพโหลดไฟล์ STOCK 0010 (.xlsx / .xls / .csv)"
            historyEndpoint="/api/upload-stock-0010"
            onUpload={uploadStock0010}
            parseFileFn={parseStockRawMaterial}
            downloadTable="stock_0010"
          />
        </div>

        <div className="border-t-4 border-orange-500 pt-4 rounded-t-sm">
          <div className="flex items-center gap-2 pb-3 mb-2">
            <span className="w-3 h-3 rounded-full bg-orange-500 shrink-0" />
            <h2 className="text-base font-semibold text-gray-700">ไฟล์ Stock คลัง 20</h2>
          </div>
          <FileUpload
            title=""
            description="อัพโหลดไฟล์ Stock คลัง 20 (.xlsx / .xls / .csv)"
            historyEndpoint="/api/upload-stock-20"
            onUpload={uploadStock20}
            parseFileFn={parseStockRawMaterial}
            downloadTable="stock_20"
          />
        </div>
      </div>
    </div>
  )
}
