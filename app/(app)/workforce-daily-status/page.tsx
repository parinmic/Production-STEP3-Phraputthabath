'use client'
import WorkforceStatusView from '@/components/WorkforceStatusView'

const STATIONS = [
  { slug: 'สะโพก',  label: 'สะโพก' },
  { slug: 'สามชั้น', label: 'สามชั้น' },
  { slug: 'ไหล่',    label: 'ไหล่' },
  { slug: 'หมูบด',   label: 'หมูบด' },
  { slug: 'สไลด์',   label: 'สไลด์' },
  { slug: 'เผาขา',   label: 'เผาขา' },
  { slug: 'เลาะขา',  label: 'เลาะขา' },
]

export default function WorkforceDailyStatusPage() {
  return <WorkforceStatusView title="ตรวจสอบสถานะกำลังคน" stations={STATIONS} />
}
