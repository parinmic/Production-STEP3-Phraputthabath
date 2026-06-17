'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

const TYPE_CONFIG: Record<string, { label: string; desc: string }> = {
  'sa-phok-special':   { label: 'สะโพกพิเศษ',   desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์สะโพกพิเศษ' },
  'lai-special':       { label: 'ไหล่พิเศษ',    desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์ไหล่พิเศษ' },
  'sam-chan-special':   { label: 'สามชั้นพิเศษ', desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์สามชั้นพิเศษ' },
  'moo-chod-special':  { label: 'หมูบดพิเศษ',   desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์หมูบดพิเศษ' },
  'slide-special':     { label: 'สไลด์พิเศษ',   desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์สไลด์พิเศษ' },
  'pao-kha-special':   { label: 'เผาขาพิเศษ',   desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์เผาขาพิเศษ' },
  'loa-kha-special':   { label: 'เลาะขาพิเศษ',  desc: 'อัพโหลด Master Logic กำลังคนสำหรับผลิตภัณฑ์เลาะขาพิเศษ' },
}

export default function ManpowerTypePage({ params }: { params: { type: string } }) {
  const cfg = TYPE_CONFIG[params.type]
  if (!cfg) return <p className="text-red-500">ไม่พบประเภทที่ระบุ</p>

  async function upload(rows: ParsedRow[], filename: string) {
    const res = await fetch(`/api/upload-master-logic-manpower?type=${params.type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename }),
    })
    return res.json()
  }

  return (
    <FileUpload
      title={`Master Logic กำลังคน — ${cfg.label}`}
      description={cfg.desc}
      historyEndpoint={`/api/upload-master-logic-manpower?type=${params.type}`}
      onUpload={upload}
      downloadTable="master_logic_manpower"
    />
  )
}
