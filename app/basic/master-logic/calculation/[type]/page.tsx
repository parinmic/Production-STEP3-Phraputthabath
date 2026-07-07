'use client'

import FileUpload from '@/components/FileUpload'
import { ParsedRow } from '@/lib/parser'

const TYPE_CONFIG: Record<string, { label: string; desc: string; dot: string }> = {
  'mas-productivity-basic': {
    label: 'Mas Productivity Basic',
    desc: 'อัตราการผลิตต่อ SKU ต่อสถานีเบสิค',
    dot: 'border-purple-500',
  },
  'mas-channel-basic': {
    label: 'Mas Channel Basic',
    desc: 'ลำดับ Channel ต่อ Phase สำหรับเบสิค',
    dot: 'border-orange-500',
  },
  'mas-variance-makro-basic': {
    label: 'Mas %Variance Makro Basic',
    desc: 'ปรับ % target Makro สำหรับเบสิค',
    dot: 'border-blue-500',
  },
  'mas-variance-wet-market-basic': {
    label: 'Mas %Variance Wet Market Basic',
    desc: 'ปรับ % target Wet Market สำหรับเบสิค',
    dot: 'border-cyan-500',
  },
  'mas-variance-lotus-basic': {
    label: 'Mas %Variance LOTUS Basic',
    desc: 'ปรับ % target LOTUS สำหรับเบสิค',
    dot: 'border-lime-500',
  },
  'mas-special-basic': {
    label: 'Mas Special Basic',
    desc: 'ช่วงเวลาเริ่ม/หยุดผลิต SKU พิเศษ สำหรับเบสิค',
    dot: 'border-pink-500',
  },
  'mas-product-type-basic': {
    label: 'Mas Product Type Basic',
    desc: 'กำหนด SKU ว่าเป็น Main Product หรือ By Product',
    dot: 'border-rose-500',
  },
  'mas-saipan': {
    label: 'Mas สายพาน',
    desc: 'mapping กลุ่มสินค้าไปสายพาน/สถานีที่ผลิต',
    dot: 'border-yellow-500',
  },
  'mas-group-station-rule': {
    label: 'Mas กลุ่มสินค้าผลิตมากกว่า 1 สายพาน',
    desc: 'route กลุ่มสินค้าไปสายพาน พร้อม split mode, priority และสัดส่วนการแบ่งงาน',
    dot: 'border-emerald-500',
  },
  'mas-raw-basket': {
    label: 'Mas ตะกร้า Raw',
    desc: 'ปริมาณวัตถุดิบต่อตะกร้า',
    dot: 'border-amber-500',
  },
}

export default function BasicCalculationTypePage({ params }: { params: { type: string } }) {
  const cfg = TYPE_CONFIG[params.type]
  if (!cfg) return <p className="text-red-500 p-8">ไม่พบประเภทที่ระบุ: {params.type}</p>

  const isSaipan = params.type === 'mas-saipan'
  const isGroupStationRule = params.type === 'mas-group-station-rule'
  const isRawBasket = params.type === 'mas-raw-basket'

  const apiEndpoint = isSaipan
    ? '/api/upload-mas-sayapan'
    : isGroupStationRule
      ? '/api/upload-mas-group-station-rule'
      : isRawBasket
        ? '/api/upload-mas-raw-basket'
        : `/api/upload-master-logic-calculation?type=${params.type}`

  const downloadTable = isSaipan
    ? 'mas_sayapan'
    : isGroupStationRule
      ? 'mas_group_station_rule'
      : isRawBasket
        ? 'mas_raw_basket'
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
        menuKey="10.2"
      />
    </div>
  )
}
