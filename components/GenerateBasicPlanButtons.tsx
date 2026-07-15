'use client'
import { useState } from 'react'
import { ClipboardList, CheckCircle2, AlertCircle, Calendar } from 'lucide-react'
import { useCanEdit } from '@/lib/session-context'
import { todayBangkok } from '@/lib/date'

const PHASES = [
  { phase: 1, label: 'Phase 1' },
  { phase: 2, label: 'Phase 2' },
  { phase: 3, label: 'Phase 3' },
]

const DEDUCT_OPTIONS: { mode: 'plan' | 'actual' | 'yield'; label: string; desc: string }[] = [
  { mode: 'plan',   label: 'แผน Phase ก่อนหน้า',     desc: 'หักลบจากยอดที่วางแผนไว้ใน Phase ก่อนหน้า' },
  { mode: 'actual', label: 'ยอดผลิต Phase ก่อนหน้า', desc: 'หักลบเฉพาะงานที่เสร็จแล้ว (สถานะ: เสร็จแล้ว)' },
  { mode: 'yield',  label: 'ยอดรับผลได้ล่าสุด',       desc: 'หักลบจากข้อมูลที่อัพโหลดในเมนู รับผลได้' },
]

// สร้างแผนผลิตฝั่งเบสิค (STEP 2) — ย้ายมาจากหน้าคำสั่งผลิตราย Station เดิม ตรรกะเหมือนเดิมทุกอย่าง
// เพียงย้ายตำแหน่งมาไว้บนหน้าอัพโหลดคำสั่งซื้อ/แผน 100% แทน (ใช้ครั้งเดียวสร้างทุก Station พร้อมกัน)
export default function GenerateBasicPlanButtons({ menuKey }: { menuKey: string }) {
  const today = todayBangkok()
  const canEdit = useCanEdit(menuKey)
  const [date, setDate]           = useState(today)
  const [generating, setGenerating] = useState<number | null>(null)
  const [genResult, setGenResult] = useState<{ success: boolean; message: string } | null>(null)
  const [modalPhase, setModalPhase] = useState<number | null>(null)

  const generatePhase = async (phase: number, deductMode: 'plan' | 'actual' | 'yield' = 'plan') => {
    setGenerating(phase); setGenResult(null); setModalPhase(null)
    try {
      const res = await fetch('/api/production/generate-basic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, phase, deductMode }),
      })
      const result = await res.json()
      setGenResult({ success: Boolean(result.success), message: result.message ?? 'สร้างแผนไม่สำเร็จ' })
    } catch { setGenResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setGenerating(null)
  }

  const handleClick = (phase: number) => {
    if (phase === 1) { generatePhase(1); return }
    setModalPhase(phase)
  }

  if (!canEdit) return null

  return (
    <>
      {modalPhase != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
             onClick={() => setModalPhase(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">สร้าง Phase {modalPhase}</h2>
            <p className="text-sm text-gray-500 mt-1 mb-5">เลือกยอดที่ใช้หักลบจากเป้าหมาย</p>
            <div className="space-y-2.5">
              {DEDUCT_OPTIONS.map(opt => (
                <button key={opt.mode} onClick={() => generatePhase(modalPhase, opt.mode)}
                  className="w-full text-left p-4 rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <div className="font-medium text-gray-900 text-sm">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setModalPhase(null)}
              className="mt-4 w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors">
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-end">
        <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-sm text-gray-700">
          <Calendar size={14} className="text-gray-400" />
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setGenResult(null) }}
            className="outline-none bg-transparent text-sm" />
        </div>

        {PHASES.map(p => (
          <button key={p.phase} type="button" onClick={() => handleClick(p.phase)} disabled={generating != null}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed">
            <ClipboardList size={15} />{generating === p.phase ? 'กำลังสร้าง...' : `สร้าง ${p.label}`}
          </button>
        ))}

        {genResult && (
          <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm border ${
            genResult.success ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {genResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {genResult.message}
          </div>
        )}
      </div>
    </>
  )
}
