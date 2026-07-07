'use client'
import FileUpload from '@/components/FileUpload'
import { parseSawMachineSku, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-mas-saw-machine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function SawMachineMasterPage() {
  return (
    <div className="border-t-4 border-teal-500 pt-4">
      <FileUpload
        title="Mas SKU ใช้เครื่องเลื่อย"
        description="คอลัมน์ที่ต้องการ: จุดงาน, กลุ่มสินค้า, SAP, ชื่อสินค้า, กำลังการผลิต (กก./ชม.), ประเภท — อัพโหลดใหม่จะแทนข้อมูลทั้งหมด"
        historyEndpoint="/api/upload-mas-saw-machine"
        onUpload={upload}
        parseFileFn={parseSawMachineSku}
        downloadTable="mas_saw_machine_sku"
        menuKey="10.2"
      />
    </div>
  )
}
