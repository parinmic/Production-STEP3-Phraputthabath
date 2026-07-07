'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-mas-yield', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MasYieldPage() {
  return (
    <div className="border-t-4 border-emerald-500 pt-4">
      <FileUpload
        title="Mas Yield"
        description="ตาราง Yield % ตามน้ำหนักซาก — คอลัมน์: น้ำหนักซาก RM, กลุ่มสินค้า, Yield"
        historyEndpoint="/api/upload-mas-yield"
        onUpload={upload}
        downloadTable="mas_yield"
        menuKey="10.2"
      />
    </div>
  )
}
