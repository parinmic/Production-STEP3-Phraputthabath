'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

const TYPE_CONFIG: Record<string, { label: string; desc: string; dot: string }> = {
  'mas-productivity':        { label: 'Mas Productivity',         desc: 'อัพโหลด Master Calculation — Productivity', dot: 'border-purple-500' },
  'mas-variance-makro':      { label: 'Mas %Variance Makro',      desc: 'อัพโหลด Master Calculation — %Variance Makro', dot: 'border-blue-500' },
  'mas-variance-wet-market': { label: 'Mas %Variance Wet Market', desc: 'อัพโหลด Master Calculation — %Variance Wet Market', dot: 'border-cyan-500' },
  'mas-variance-lotus':      { label: 'Mas %Variance LOTUS',      desc: 'อัพโหลด Master Calculation — %Variance LOTUS', dot: 'border-lime-500' },
  'mas-lotus':               { label: 'Mas LOTUS',                desc: 'อัพโหลด Master Calculation — LOTUS', dot: 'border-green-500' },
  'mas-channel':             { label: 'Mas Channel',              desc: 'อัพโหลด Master Calculation — Channel', dot: 'border-orange-500' },
  'mas-trakra':              { label: 'Mas ตระกร้า',              desc: 'อัพโหลด Master Calculation — ตระกร้า', dot: 'border-yellow-500' },
  'mas-special':             { label: 'Mas Special',              desc: 'อัพโหลด Master Calculation — Special SKUs', dot: 'border-pink-500' },
  'mas-sku-concurrent':      { label: 'Mas Sku ผลิตพร้อมกัน',    desc: 'อัพโหลด Master — กลุ่มสินค้าที่ผลิตพร้อมกัน (Sap ตั้งต้น, ชื่อสินค้าตั้งต้น, Sap ผลพลอยได้, ชื่อสินค้าผลพลอยได้)', dot: 'border-teal-500' },
  'mas-raw-material':        { label: 'Mas Raw Material',         desc: 'อัพโหลด Master Calculation — Raw Material (D16, D17)', dot: 'border-red-500' },
}

export default function CalculationTypePage({ params }: { params: { type: string } }) {
  const cfg = TYPE_CONFIG[params.type]
  if (!cfg) return <p className="text-red-500">ไม่พบประเภทที่ระบุ</p>

  async function upload(rows: ParsedRow[], filename: string) {
    const res = await fetch(`/api/upload-master-logic-calculation?type=${params.type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, filename }),
    })
    return res.json()
  }

  return (
    <div className={`border-t-4 ${cfg.dot} pt-4`}>
      <FileUpload
        title={cfg.label}
        description={cfg.desc}
        historyEndpoint={`/api/upload-master-logic-calculation?type=${params.type}`}
        onUpload={upload}
        downloadTable="master_logic_calculation"
        menuKey="10.2"
      />
    </div>
  )
}
