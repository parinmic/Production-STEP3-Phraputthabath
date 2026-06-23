'use client'
import FileUpload from '@/components/FileUpload'
import { parseMasBeikKha, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-mas-beik-kha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MasBeikKhaPage() {
  return (
    <div className="border-t-4 border-rose-500 pt-4">
      <FileUpload
        title="Master ผลิตต่อกัน"
        description="คอลัมน์ที่ต้องการ: กลุ่มสินค้า, SAP, ชื่อสินค้า, ต้นทาง (จุดงานผู้ผลิต WIP), ปลายทาง (จุดงานผู้รับ WIP) — อัพโหลดใหม่จะแทนข้อมูลทั้งหมด"
        historyEndpoint="/api/upload-mas-beik-kha"
        onUpload={upload}
        parseFileFn={parseMasBeikKha}
        downloadTable="mas_beik_kha"
      />
    </div>
  )
}
