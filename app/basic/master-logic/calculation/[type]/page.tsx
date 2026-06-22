'use client'
import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

const TYPE_CONFIG: Record<string, { label: string; desc: string; dot: string }> = {
  // Basic-specific masters
  'mas-productivity-basic':        { label: 'Mas Productivity Basic',       desc: 'อัตราการผลิต (กก./ชม./คน) ต่อ SKU ต่อสถานีเบสิค', dot: 'border-purple-500' },
  'mas-channel-basic':             { label: 'Mas Channel Basic',             desc: 'ลำดับ Channel ต่อ Phase — เบสิค', dot: 'border-orange-500' },
  'mas-variance-makro-basic':      { label: 'Mas %Variance Makro Basic',     desc: 'ปรับ % target Makro — เบสิค', dot: 'border-blue-500' },
  'mas-variance-wet-market-basic': { label: 'Mas %Variance Wet Market Basic',desc: 'ปรับ % target Wet Market — เบสิค', dot: 'border-cyan-500' },
  'mas-variance-lotus-basic':      { label: 'Mas %Variance LOTUS Basic',     desc: 'ปรับ % target LOTUS — เบสิค', dot: 'border-lime-500' },
  'mas-special-basic':             { label: 'Mas Special Basic',             desc: 'ช่วงเวลาเริ่ม/หยุดผลิต SKU พิเศษ — เบสิค', dot: 'border-pink-500' },
  'mas-product-type-basic':        { label: 'Mas Product Type Basic',        desc: 'กำหนด SKU ว่าเป็น Main Product (ผลิตเป็น RAW) หรือ By Product (ผลิตเป็น SKU) — คอลัมน์: SAP | ประเภท (Main/By)', dot: 'border-rose-500' },
  // STEP2 shared masters
  'mas-saipan':                    { label: 'Mas สายพาน',                   desc: 'mapping กลุ่มสินค้า → สายพาน/สถานีที่ผลิต', dot: 'border-yellow-500' },
  'mas-raw-basket':                { label: 'Mas ตะกร้า Raw',               desc: 'ปริมาณวัตถุดิบต่อตะกร้า (UNIX, SAP, ชื่อ, กก./ตะกร้า)', dot: 'border-amber-500' },
}

export default function BasicCalculationTypePage({ params }: { params: { type: string } }) {
  const cfg = TYPE_CONFIG[params.type]
  if (!cfg) return <p className="text-red-500 p-8">ไม่พบประเภทที่ระบุ: {params.type}</p>

  const isSaipan    = params.type === 'mas-saipan'
  const isRawBasket = params.type === 'mas-raw-basket'
  const apiEndpoint   = isSaipan ? '/api/upload-mas-sayapan'
    : isRawBasket      ? '/api/upload-mas-raw-basket'
    : `/api/upload-master-logic-calculation?type=${params.type}`
  const downloadTable = isSaipan ? 'mas_sayapan'
    : isRawBasket      ? 'mas_raw_basket'
    : 'master_logic_calculation'

  async function upload(rows: ParsedRow[], filename: string) {
    const res = await fetch(apiEndpoint, {
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
        historyEndpoint={apiEndpoint}
        onUpload={upload}
        downloadTable={downloadTable}
      />
    </div>
  )
}
