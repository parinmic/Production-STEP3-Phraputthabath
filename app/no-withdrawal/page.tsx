'use client'
import FileUpload from '@/components/FileUpload'
import { parseNoWithdrawalSkus, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-no-withdrawal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function NoWithdrawalPage() {
  return (
    <FileUpload
      title="Mas SKU ที่ไม่ต้องเบิกของ"
      description="ตารางรหัสสินค้า SKU ที่มีแผนผลิตแต่ไม่ต้องทำใบเบิกของ — คอลัมน์ที่ต้องการ: จุดงาน, กลุ่มสินค้า, SAP, ชื่อสินค้า"
      historyEndpoint="/api/upload-no-withdrawal"
      onUpload={upload}
      parseFileFn={parseNoWithdrawalSkus}
    />
  )
}
