'use client'
import FileUpload from '@/components/FileUpload'
import { parseMasSpecialRaw, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-mas-special-raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MasSpecialRawPage() {
  return (
    <div className="border-t-4 border-amber-500 pt-4">
      <FileUpload
        title="Mas Special Raw"
        description="คอลัมน์ที่ต้องการ: กลุ่มสินค้า, จุดงาน, D16, D17 — D16/D17 คืออักขระตำแหน่งที่ 16 และ 17 ของเลข Lot ที่ต้องการดึงมาใช้ก่อน FIFO ปกติ — อัพโหลดใหม่จะแทนข้อมูลทั้งหมด"
        historyEndpoint="/api/upload-mas-special-raw"
        onUpload={upload}
        parseFileFn={parseMasSpecialRaw}
        downloadTable="mas_special_raw"
        menuKey="10.2"
      />
    </div>
  )
}
