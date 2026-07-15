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

// สร้างแผนผลิตฝั่งเบสิค (STEP 2) — ย้ายมาจากหน้าคำสั่งผลิตราย Station เดิม ตรรกะเหมือนเดิมทุกอย่าง
// เพียงย้ายตำแหน่งมาไว้บนหน้าอัพโหลดคำสั่งซื้อ/แผน 100% แทน (ใช้ครั้งเดียวสร้างทุก Station พร้อมกัน)
export default function GenerateBasicPlanButtons({ menuKey }: { menuKey: string }) {
  const today = todayBangkok()
  const canEdit = useCanEdit(menuKey)
  const [date, setDate]           = useState(today)
  const [generating, setGenerating] = useState<number | null>(null)
  const [genResult, setGenResult] = useState<{ success: boolean; message: string } | null>(null)
  const [phase2PromptOpen, setPhase2PromptOpen] = useState(false)
  const [phase3PromptOpen, setPhase3PromptOpen] = useState(false)
  const [subtractPhase1FromPhase3, setSubtractPhase1FromPhase3] = useState(false)
  const [subtractPhase2FromPhase3, setSubtractPhase2FromPhase3] = useState(false)

  const generatePhase = async (phase: number, options?: {
    subtractPhase1FromPhase2?: boolean
    subtractPhase1FromPhase3?: boolean
    subtractPhase2FromPhase3?: boolean
  }) => {
    setGenerating(phase); setGenResult(null)
    try {
      const res = await fetch('/api/production/generate-basic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, phase, ...options }),
      })
      const result = await res.json()
      setGenResult({ success: Boolean(result.success), message: result.message ?? 'สร้างแผนไม่สำเร็จ' })
    } catch { setGenResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setGenerating(null)
  }

  const handleClick = (phase: number) => {
    if (phase === 2) { setPhase2PromptOpen(true); return }
    if (phase === 3) { setPhase3PromptOpen(true); return }
    generatePhase(1)
  }

  const handlePhase2SubtractChoice = (subtractPhase1: boolean) => {
    setPhase2PromptOpen(false)
    generatePhase(2, { subtractPhase1FromPhase2: subtractPhase1 })
  }

  const handlePhase3Confirm = () => {
    setPhase3PromptOpen(false)
    generatePhase(3, { subtractPhase1FromPhase3, subtractPhase2FromPhase3 })
  }

  if (!canEdit) return null

  return (
    <>
      {phase2PromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">สร้าง Phase 2</h2>
              <p className="mt-1 text-sm text-gray-500">ต้องการหักยอด Phase 1 ออกจากยอด Phase 2 ก่อนสร้างแผนหรือไม่</p>
            </div>
            <div className="px-5 py-4 flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={() => handlePhase2SubtractChoice(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
                ไม่หัก Phase 1
              </button>
              <button type="button" onClick={() => handlePhase2SubtractChoice(true)}
                className="px-4 py-2 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700">
                หัก Phase 1
              </button>
            </div>
          </div>
        </div>
      )}

      {phase3PromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">สร้าง Phase 3</h2>
              <p className="mt-1 text-sm text-gray-500">เลือกแผนก่อนหน้าที่ต้องการหักออกก่อนสร้าง Phase 3</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700">
                <input type="checkbox" checked={subtractPhase1FromPhase3}
                  onChange={e => setSubtractPhase1FromPhase3(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
                หักแผน Phase 1
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700">
                <input type="checkbox" checked={subtractPhase2FromPhase3}
                  onChange={e => setSubtractPhase2FromPhase3(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
                หักแผน Phase 2
              </label>
            </div>
            <div className="px-5 py-4 flex flex-col sm:flex-row gap-2 sm:justify-end border-t border-gray-100">
              <button type="button" onClick={() => setPhase3PromptOpen(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button type="button" onClick={handlePhase3Confirm}
                className="px-4 py-2 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-gray-800">
                ยืนยัน
              </button>
            </div>
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
