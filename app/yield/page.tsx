'use client'
import FileUpload from '@/components/FileUpload'
import { parseFile, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-yield', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function YieldPage() {
  return (
    <FileUpload
      title="อัพโหลด รับผลได้"
      description="อัพโหลดไฟล์ข้อมูลรับผลได้ — รองรับ .xlsx, .xls, .csv"
      historyEndpoint="/api/upload-yield"
      onUpload={upload}
      parseFileFn={parseFile}
    />
  )
}
