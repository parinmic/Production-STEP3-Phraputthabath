'use client'
import FileUpload from '@/components/FileUpload'
import { parseMasPriorityWithdrawal, ParsedRow } from '@/lib/parser'

async function upload(rows: ParsedRow[], filename: string) {
  const res = await fetch('/api/upload-mas-priority-withdrawal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows, filename }),
  })
  return res.json()
}

export default function MasPriorityWithdrawalPage() {
  return (
    <FileUpload
      title="Mas Priority เบิก RM"
      description="อัพโหลดไฟล์ Excel / CSV ที่มีคอลัมน์ Phase, Station, ลำดับ, เงื่อนไข"
      historyEndpoint="/api/upload-mas-priority-withdrawal"
      onUpload={upload}
      parseFileFn={parseMasPriorityWithdrawal}
      downloadTable="mas_priority_withdrawal"
      menuKey="10.2"
    />
  )
}
