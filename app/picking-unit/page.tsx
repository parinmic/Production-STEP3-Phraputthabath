'use client'
import FileUpload from '@/components/FileUpload'
import { parsePickingUnit, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-picking-unit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function PickingUnitPage() {
  return (
    <FileUpload
      title="Mas หน่วยหยิบสินค้า"
      description="ตารางเทียบน้ำหนัก (กก.) เป็นจำนวนถุง — คอลัมน์: SAP, ชื่อสินค้า, น้ำหนักต่อถุง (กก.), หน่วย"
      historyEndpoint="/api/upload-picking-unit"
      onUpload={upload}
      parseFileFn={parsePickingUnit}
      downloadTable="picking_unit_master"
    />
  )
}
