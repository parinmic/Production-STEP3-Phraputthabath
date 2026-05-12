'use client'
import FileUpload from '@/components/FileUpload'
import { parseQuotaForecast, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-quota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function QuotaPage() {
  return (
    <FileUpload
      title="อัพโหลด Quota ช่องทางขาย"
      description="อัพโหลดไฟล์ FC 7Days Pork All Factory — ระบบจะใช้ข้อมูลชีท 'FC 7Days แยกรายวัน' ของโรงชำแหละสุกรพระพุทธบาท"
      historyEndpoint="/api/upload-quota"
      onUpload={upload}
      parseFileFn={parseQuotaForecast}
    />
  )
}
