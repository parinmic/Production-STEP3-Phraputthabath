'use client'
import FileUpload from '@/components/FileUpload'
import { parseBomSpecial, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-bom-special', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function BomSpecialPage() {
  return (
    <div className="border-t-4 border-violet-500 pt-4">
      <FileUpload
        title="BOM พิเศษ"
        description="คอลัมน์ที่ต้องการ: Code, Sap (รหัส SAP สินค้า), สินค้า, รหัส Raw, SAP RAW, ชื่อ Raw, %Yield (≤16 กก./ตะกร้า), %Yield (16-18 กก./ตะกร้า), %Yield (≥18 กก./ตะกร้า) — อัพโหลดใหม่จะแทนข้อมูลทั้งหมด"
        historyEndpoint="/api/upload-bom-special"
        onUpload={upload}
        parseFileFn={parseBomSpecial}
        downloadTable="bom_special"
      />
    </div>
  )
}
