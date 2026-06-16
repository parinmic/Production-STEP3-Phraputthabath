'use client'
import FileUpload from '@/components/FileUpload'
import { parseBom, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-bom-basic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function BasicBomPage() {
  return (
    <FileUpload
      title="อัพโหลด BOM สินค้า (เบสิค)"
      description="Bill of Materials — เชื่อมโยง SAP สินค้าสำเร็จรูปกับวัตถุดิบและ % Yield (ชีท หมูขาว)"
      historyEndpoint="/api/upload-bom-basic"
      onUpload={upload}
      parseFileFn={parseBom}
      downloadTable="bom_items_basic"
    />
  )
}
