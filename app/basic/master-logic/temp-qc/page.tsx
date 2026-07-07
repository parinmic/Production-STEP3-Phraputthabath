'use client'

import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

export default function BasicTempQcMasterPage() {
  async function upload(rows: ParsedRow[], filename: string) {
    const res = await fetch('/api/qc-temp-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename }),
    })
    return res.json()
  }

  return (
    <div className="border-t-4 border-cyan-500 pt-4">
      <FileUpload
        title="Mas Temp QC"
        description="Master เงื่อนไขสีสำหรับตรวจอุณหภูมิ QC หมูซีกและชิ้นส่วน"
        historyEndpoint="/api/qc-temp-master"
        onUpload={upload}
        downloadTable="master_logic_calculation"
        menuKey="10.2"
      />
    </div>
  )
}
