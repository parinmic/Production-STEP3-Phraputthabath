'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

const TYPE_CONFIG: Record<string, { label: string; desc: string; dot: string }> = {
  'sa-phok-basic':  { label: 'สะโพกเบสิค',   desc: 'อัพโหลด Master Logic กำลังคนสำหรับสะโพกเบสิค',   dot: 'border-orange-500' },
  'lai-basic':      { label: 'ไหล่เบสิค',    desc: 'อัพโหลด Master Logic กำลังคนสำหรับไหล่เบสิค',    dot: 'border-green-500' },
  'sam-chan-basic':  { label: 'สามชั้นเบสิค', desc: 'อัพโหลด Master Logic กำลังคนสำหรับสามชั้นเบสิค', dot: 'border-blue-500' },
  'perd-moo':       { label: 'เปิดหมู',      desc: 'อัพโหลด Master Logic กำลังคนสำหรับสถานีเปิดหมู', dot: 'border-slate-500' },
  'sa-phok-special':{ label: 'สะโพกพิเศษ',  desc: 'อัพโหลด Master Logic กำลังคนสำหรับสะโพกพิเศษ',  dot: 'border-orange-500' },
  'lai-special':    { label: 'ไหล่พิเศษ',   desc: 'อัพโหลด Master Logic กำลังคนสำหรับไหล่พิเศษ',   dot: 'border-green-500' },
  'sam-chan-special':{ label: 'สามชั้นพิเศษ',desc: 'อัพโหลด Master Logic กำลังคนสำหรับสามชั้นพิเศษ',dot: 'border-blue-500' },
  'moo-chod-special':{ label: 'หมูบดพิเศษ', desc: 'อัพโหลด Master Logic กำลังคนสำหรับหมูบดพิเศษ', dot: 'border-red-500' },
  'slide-special':  { label: 'สไลด์พิเศษ',  desc: 'อัพโหลด Master Logic กำลังคนสำหรับสไลด์พิเศษ',  dot: 'border-purple-500' },
}

export default function BasicManpowerTypePage({ params }: { params: { type: string } }) {
  const cfg = TYPE_CONFIG[params.type]
  if (!cfg) return <p className="text-red-500 p-8">ไม่พบประเภทที่ระบุ: {params.type}</p>

  async function upload(rows: ParsedRow[], filename: string) {
    const res = await fetch(`/api/upload-master-logic-manpower?type=${params.type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename }),
    })
    return res.json()
  }

  return (
    <div className={`border-t-4 ${cfg.dot} pt-4`}>
      <FileUpload
        title={`Master Logic กำลังคน — ${cfg.label}`}
        description={cfg.desc}
        historyEndpoint={`/api/upload-master-logic-manpower?type=${params.type}`}
        onUpload={upload}
        downloadTable="master_logic_manpower"
        menuKey="10.1"
      />
    </div>
  )
}
