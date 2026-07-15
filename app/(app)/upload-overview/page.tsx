'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CheckCircle2, Upload, X, AlertCircle, Pencil, Check, Eye, Calendar } from 'lucide-react'
import ExcelIcon from '@/components/icons/ExcelIcon'
import { ParsedRow, parseLotusWetMarketFile, parseMakroAuto, parsePlan100 } from '@/lib/parser'
import { useCanEdit } from '@/lib/session-context'
import { todayBangkok } from '@/lib/date'

type ChannelKey = 'makro' | 'lotus' | 'wet-market' | 'fs'
type SlotKey = '0800' | '1400' | '1600' | '100'

interface UploadRecord {
  id: string
  source_file: string
  record_count: number
  uploaded_at: string
  data_date: string | null
}

interface PendingUpload {
  channel: ChannelKey
  slot: SlotKey
  file: File
  status: 'parsing' | 'ready' | 'submitting' | 'error'
  message: string
  rows: ParsedRow[]
}

interface CellConfig {
  historyEndpoint: string
  postUrl: string
  round?: string
  menuKey: string
}

function parserFor(channel: ChannelKey, slot: SlotKey) {
  if (slot === '100') return parsePlan100
  if (channel === 'makro' && slot === '1400') return parseMakroAuto
  return parseLotusWetMarketFile
}

const CHANNELS: { key: ChannelKey; label: string }[] = [
  { key: 'makro',      label: 'Makro' },
  { key: 'lotus',      label: 'LOTUS' },
  { key: 'wet-market', label: 'Wet Market' },
  { key: 'fs',         label: 'Food Service' },
]

const SLOTS: { key: SlotKey; label: string; phase?: number }[] = [
  { key: '0800', label: '8:00',       phase: 1 },
  { key: '1400', label: '14:00',      phase: 2 },
  { key: '1600', label: '16:00' },
  { key: '100',  label: 'แผน 100%',   phase: 3 },
]

// ช่องทาง x รอบไหนที่ต้องอัพโหลดจริงในระบบปัจจุบัน — รอบที่ไม่ต้องใช้จะถูกทึบเทาและไม่มีปุ่มเลือกไฟล์
const ACTIVE: Record<ChannelKey, Record<SlotKey, boolean>> = {
  'makro':      { '0800': true,  '1400': true, '1600': false, '100': false },
  'lotus':      { '0800': false, '1400': true, '1600': true,  '100': true  },
  'wet-market': { '0800': false, '1400': true, '1600': true,  '100': true  },
  'fs':         { '0800': false, '1400': false, '1600': true,  '100': false },
}

// ต่อ endpoint จริงของแต่ละช่อง/รอบ (คนละ endpoint กับหน้าอัพโหลดเดิม แต่คอนแทร็คเดียวกันทุกตัว)
// กล่อง "แผน 100%" ที่รวม LOTUS+Wet Market ยิงไป upload-plan100 (เขียน production_plan_100 เหมือนหน้า /plan-100 เดิม)
const CELL_CONFIGS: Partial<Record<string, CellConfig>> = {
  'makro:0800':      { historyEndpoint: '/api/upload-makro?round=0800',      postUrl: '/api/upload-makro?round=0800',      round: '0800', menuKey: '7.1' },
  'makro:1400':      { historyEndpoint: '/api/upload-makro?round=1400',      postUrl: '/api/upload-makro?round=1400',      round: '1400', menuKey: '7.1' },
  'lotus:1400':      { historyEndpoint: '/api/upload-lotus?round=1400',      postUrl: '/api/upload-lotus?round=1400',      round: '1400', menuKey: '7.2' },
  'lotus:1600':      { historyEndpoint: '/api/upload-lotus?round=1600',      postUrl: '/api/upload-lotus?round=1600',      round: '1600', menuKey: '7.2' },
  'wet-market:1400': { historyEndpoint: '/api/upload-wet-market?round=1400', postUrl: '/api/upload-wet-market?round=1400', round: '1400', menuKey: '7.3' },
  'wet-market:1600': { historyEndpoint: '/api/upload-wet-market?round=1600', postUrl: '/api/upload-wet-market?round=1600', round: '1600', menuKey: '7.3' },
  'fs:1600':         { historyEndpoint: '/api/upload-fs',                    postUrl: '/api/upload-fs',                                   menuKey: '7.4' },
  'lotus:100':       { historyEndpoint: '/api/upload-plan100',               postUrl: '/api/upload-plan100',                              menuKey: '7.5' },
}

const DEDUCT_OPTIONS: { mode: 'plan' | 'actual' | 'yield'; label: string; desc: string }[] = [
  { mode: 'plan',   label: 'แผน Phase ก่อนหน้า',     desc: 'หักลบจากยอดที่วางแผนไว้ใน Phase ก่อนหน้า' },
  { mode: 'actual', label: 'ยอดผลิต Phase ก่อนหน้า', desc: 'หักลบเฉพาะงานที่เสร็จแล้ว (สถานะ: เสร็จแล้ว)' },
  { mode: 'yield',  label: 'ยอดรับผลได้ล่าสุด',       desc: 'หักลบจากข้อมูลที่อัพโหลดในเมนู รับผลได้' },
]

export default function UploadOverviewPage() {
  const pathname = usePathname()
  const isBasic = pathname?.startsWith('/basic') ?? false
  const channels = isBasic ? CHANNELS.filter(c => c.key !== 'fs') : CHANNELS

  const canEdit71 = useCanEdit('7.1')
  const canEdit72 = useCanEdit('7.2')
  const canEdit73 = useCanEdit('7.3')
  const canEdit74 = useCanEdit('7.4')
  const canEdit75 = useCanEdit('7.5')
  const editableByKey: Record<string, boolean> = { '7.1': canEdit71, '7.2': canEdit72, '7.3': canEdit73, '7.4': canEdit74, '7.5': canEdit75 }
  const anyEdit = canEdit71 || canEdit72 || canEdit73 || canEdit74 || canEdit75

  const [history, setHistory] = useState<Record<string, UploadRecord[]>>({})
  const [pending, setPending] = useState<PendingUpload | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [historyChannel, setHistoryChannel] = useState<'all' | ChannelKey>('all')
  const [historySlot, setHistorySlot] = useState<'all' | SlotKey>('all')
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const today = todayBangkok()
  const [phaseDate, setPhaseDate] = useState(today)
  const [midRecal, setMidRecal] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('midRecalEnabled_v2') === 'true'
  })
  const [generatingPhase, setGeneratingPhase] = useState<number | null>(null)
  const [genResult, setGenResult] = useState<{ success: boolean; message: string } | null>(null)
  const [modalPhase, setModalPhase] = useState<number | null>(null)

  useEffect(() => { localStorage.setItem('midRecalEnabled_v2', String(midRecal)) }, [midRecal])

  const cellId = (channel: ChannelKey, slot: SlotKey) => `${channel}:${slot}`

  const fetchHistory = async (id: string) => {
    const cfg = CELL_CONFIGS[id]
    if (!cfg) return
    try {
      const res = await fetch(cfg.historyEndpoint)
      const data = await res.json()
      setHistory(prev => ({ ...prev, [id]: data.uploads ?? [] }))
    } catch { /* silent, keep previous */ }
  }

  useEffect(() => {
    Object.keys(CELL_CONFIGS)
      .filter(id => !isBasic || !id.startsWith('fs:'))
      .forEach(id => { fetchHistory(id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetInput = (channel: ChannelKey, slot: SlotKey) => {
    const el = inputRefs.current[cellId(channel, slot)]
    if (el) el.value = ''
  }

  const handlePick = async (channel: ChannelKey, slot: SlotKey, file: File) => {
    setPending({ channel, slot, file, status: 'parsing', message: '', rows: [] })
    try {
      const rows = await parserFor(channel, slot)(file)
      if (!rows.length) throw new Error('ไฟล์ไม่มีข้อมูล')
      setPending({ channel, slot, file, status: 'ready', message: '', rows })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้'
      setPending({ channel, slot, file, status: 'error', message, rows: [] })
    }
  }

  const closePending = () => {
    if (pending) resetInput(pending.channel, pending.slot)
    setPending(null)
  }

  const errMsg = (e: unknown) =>
    e instanceof Error ? e.message
    : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message)
    : 'เกิดข้อผิดพลาด'

  const confirmPending = async () => {
    if (!pending || (pending.status !== 'ready' && pending.status !== 'error')) return
    const id = cellId(pending.channel, pending.slot)
    const cfg = CELL_CONFIGS[id]
    if (!cfg) return
    setPending(prev => (prev ? { ...prev, status: 'submitting', message: '' } : prev))
    try {
      const res = await fetch(cfg.postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: pending.rows, filename: pending.file.name, round: cfg.round }),
      })
      const result = await res.json()
      if (!result.success) {
        setPending(prev => (prev ? { ...prev, status: 'error', message: result.message ?? 'บันทึกไม่สำเร็จ' } : prev))
        return
      }
      resetInput(pending.channel, pending.slot)
      await fetchHistory(id)
      setPending(null)
    } catch (e: unknown) {
      setPending(prev => (prev ? { ...prev, status: 'error', message: errMsg(e) } : prev))
    }
  }

  const handleDelete = async (id: string, record: UploadRecord) => {
    if (!confirm(`ลบ "${record.source_file}" และข้อมูลที่อัพโหลดออกจากระบบ?`)) return
    const cfg = CELL_CONFIGS[id]
    if (!cfg) return
    try {
      const sep = cfg.historyEndpoint.includes('?') ? '&' : '?'
      const res = await fetch(`${cfg.historyEndpoint}${sep}id=${encodeURIComponent(record.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setHistory(prev => ({ ...prev, [id]: (prev[id] ?? []).filter(r => r.id !== record.id) }))
      } else {
        alert(data.message ?? 'ลบไม่สำเร็จ')
      }
    } catch { alert('เกิดข้อผิดพลาด') }
  }

  const generatePhase = async (phase: number, deductMode: 'plan' | 'actual' | 'yield' = 'plan') => {
    setGeneratingPhase(phase); setGenResult(null); setModalPhase(null)
    try {
      const res = await fetch('/api/production/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: phaseDate, phase, deductMode, disableMidRecal: phase === 1 ? !midRecal : true }),
      })
      const result = await res.json()
      setGenResult({ success: !!result.success, message: result.message ?? 'สร้างแผนไม่สำเร็จ' })
    } catch { setGenResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setGeneratingPhase(null)
  }

  const generatePhaseBasic = async (phase: number, deductMode: 'plan' | 'actual' | 'yield' = 'plan') => {
    setGeneratingPhase(phase); setGenResult(null); setModalPhase(null)
    try {
      const res = await fetch('/api/production/generate-basic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: phaseDate, phase, deductMode }),
      })
      const result = await res.json()
      setGenResult({ success: !!result.success, message: result.message ?? 'สร้างแผนไม่สำเร็จ' })
    } catch { setGenResult({ success: false, message: 'เกิดข้อผิดพลาด' }) }
    setGeneratingPhase(null)
  }

  const handlePhaseClick = (phase: number) => {
    if (isBasic) {
      if (phase === 2 || phase === 3) { setModalPhase(phase); return }
      generatePhaseBasic(1)
      return
    }
    if (phase === 1) { generatePhase(1); return }
    setModalPhase(phase)
  }

  const historyList = Object.entries(history)
    .flatMap(([id, records]) => {
      const [channel, slot] = id.split(':') as [ChannelKey, SlotKey]
      return records.map(r => ({ ...r, channel, slot, cellIdKey: id }))
    })
    .filter(item => !isBasic || item.channel !== 'fs')
    .filter(item => historyChannel === 'all' || item.channel === historyChannel)
    .filter(item => historySlot === 'all' || item.slot === historySlot)
    .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1))
    .slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">อัพโหลดข้อมูลคำสั่งซื้อรายช่องทาง</h1>
        {anyEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-sm text-gray-700">
              <Calendar size={14} className="text-gray-400" />
              <input type="date" value={phaseDate} onChange={e => { setPhaseDate(e.target.value); setGenResult(null) }}
                className="outline-none bg-transparent text-sm" />
            </div>
            {!isBasic && (
              <label className="inline-flex items-center cursor-pointer select-none gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-100 transition-colors">
                <span className="text-xs font-semibold text-gray-600">
                  {midRecal ? 'ค้างแผนเก่า (Mid Recal)' : 'สร้างใหม่ทั้งหมด'}
                </span>
                <div className="relative">
                  <input type="checkbox" checked={midRecal} onChange={e => setMidRecal(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                </div>
              </label>
            )}
            {genResult && (
              <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm border ${
                genResult.success ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                {genResult.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {genResult.message}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card !p-4 relative">
        <div className="overflow-x-auto">
        <table className="w-full table-fixed border-separate" style={{ borderSpacing: '0 6px' }}>
          <thead>
            <tr>
              <th className="w-36 px-3 pb-2 border-b border-dashed border-gray-300" />
              {SLOTS.map(s => (
                <th key={s.key} className="px-3 pb-2 w-[180px] border-b border-dashed border-gray-300">
                  {s.phase && (
                    <button
                      onClick={() => handlePhaseClick(s.phase!)}
                      disabled={generatingPhase === s.phase}
                      className="btn-primary w-full h-14 flex items-center justify-center text-sm disabled:opacity-60"
                    >
                      {generatingPhase === s.phase ? 'กำลังสร้าง...' : `สร้าง Phase ${s.phase}`}
                    </button>
                  )}
                </th>
              ))}
            </tr>
            <tr>
              <th className="px-3 w-36">
                {anyEdit && (
                  <button
                    onClick={() => setEditMode(v => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shadow-sm transition-colors ${
                      editMode ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                    }`}
                  >
                    {editMode ? <><Check size={12} />เสร็จสิ้น</> : <><Pencil size={12} />แก้ไข</>}
                  </button>
                )}
              </th>
              {SLOTS.map(s => (
                <th key={s.key} className="text-center text-base font-semibold text-gray-900 px-3 pb-1.5 w-[180px]">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map(ch => (
              <tr key={ch.key}>
                <td className="text-base text-gray-900 px-3 align-middle whitespace-nowrap">{ch.label}</td>
                {SLOTS.map(slot => {
                  // แผน 100% ของ LOTUS และ Wet Market ใช้ไฟล์เดียวกัน → รวมเป็นกล่องใหญ่ 1 กล่อง คร่อม 2 แถว
                  const isMergedPlan100 = slot.key === '100' && ch.key === 'lotus' && ACTIVE['wet-market']['100']
                  const isHiddenByMerge = slot.key === '100' && ch.key === 'wet-market' && ACTIVE['lotus']['100']
                  if (isHiddenByMerge) return null

                  const active = ACTIVE[ch.key][slot.key]
                  const id = cellId(ch.key, slot.key)
                  const cfg = CELL_CONFIGS[id]
                  // กล่องนับว่า "มีไฟล์แล้ว" เฉพาะไฟล์ที่ข้อมูลข้างในเป็นของ phaseDate เท่านั้น
                  // ไม่ใช่ไฟล์ล่าสุดที่เคยอัพโหลด — ของเก่าของวันอื่นไม่ทำให้กล่องติดค้างเป็นสีเขียว
                  const latest = history[id]?.find(r => r.data_date === phaseDate)
                  const canEditCell = cfg ? editableByKey[cfg.menuKey] : false
                  const boxHeight = isMergedPlan100 ? 'h-[118px]' : 'h-14'

                  if (!active) {
                    return (
                      <td key={slot.key} className="px-3">
                        <div className="h-14 rounded-xl bg-gray-200" />
                      </td>
                    )
                  }

                  return (
                    <td key={slot.key} className="px-3" rowSpan={isMergedPlan100 ? 2 : undefined}>
                      {latest ? (
                        <div className={`${boxHeight} rounded-xl border border-green-200 bg-green-50 flex items-center gap-2 px-3 relative`}>
                          <ExcelIcon size={22} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] leading-snug font-medium text-gray-800 line-clamp-2 break-all">{latest.source_file}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {new Date(latest.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                            </p>
                          </div>
                          <CheckCircle2 className="text-green-600 shrink-0" size={18} />
                          {editMode && canEditCell && (
                            <button
                              onClick={() => handleDelete(id, latest)}
                              className="absolute -top-2 -right-2 bg-white border border-red-300 rounded-full p-1 text-red-600 hover:bg-red-50 shadow-sm"
                              title="ลบไฟล์"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ) : canEditCell ? (
                        <div
                          onClick={() => inputRefs.current[id]?.click()}
                          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handlePick(ch.key, slot.key, f) }}
                          onDragOver={e => e.preventDefault()}
                          className={`${boxHeight} rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 bg-white flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors`}
                        >
                          <Upload className="text-gray-400" size={16} />
                          <span className="text-xs text-gray-400">เลือกไฟล์</span>
                          <input
                            ref={el => { inputRefs.current[id] = el }}
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) handlePick(ch.key, slot.key, f) }}
                          />
                        </div>
                      ) : (
                        <div className={`${boxHeight} rounded-xl border border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-0.5`}>
                          <Eye className="text-gray-300" size={14} />
                          <span className="text-[11px] text-gray-400">ดูอย่างเดียว</span>
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card !p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="font-semibold text-gray-800 text-sm">ประวัติการอัพโหลด</p>
          <div className="flex items-center gap-2">
            <select
              value={historyChannel}
              onChange={e => setHistoryChannel(e.target.value as 'all' | ChannelKey)}
              className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 outline-none"
            >
              <option value="all">ทุกช่องทาง</option>
              {channels.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select
              value={historySlot}
              onChange={e => setHistorySlot(e.target.value as 'all' | SlotKey)}
              className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 outline-none"
            >
              <option value="all">ทุกรอบ</option>
              {SLOTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {historyList.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">ยังไม่มีไฟล์ที่อัพโหลด</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {historyList.map(item => {
              const cfg = CELL_CONFIGS[item.cellIdKey]
              const canEditItem = cfg ? editableByKey[cfg.menuKey] : false
              return (
                <div key={`${item.cellIdKey}-${item.id}`} className="flex items-center gap-3 py-2.5">
                  <ExcelIcon size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-gray-700 truncate">{item.source_file}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {CHANNELS.find(c => c.key === item.channel)?.label} · {SLOTS.find(s => s.key === item.slot)?.label}
                      {item.data_date && (
                        <>
                          <span className="mx-1.5">·</span>
                          ข้อมูลวันที่ {new Date(item.data_date).toLocaleDateString('th-TH', { dateStyle: 'short' })}
                        </>
                      )}
                      <span className="mx-1.5">·</span>
                      {item.record_count.toLocaleString()} รายการ
                      <span className="mx-1.5">·</span>
                      อัพโหลดเมื่อ {new Date(item.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                  {canEditItem && (
                    <button
                      onClick={() => handleDelete(item.cellIdKey, item)}
                      className="shrink-0 text-gray-300 hover:text-red-500 transition-colors p-1"
                      title="ลบ"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modalPhase != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setModalPhase(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-gray-900">สร้าง Phase {modalPhase}</h2>
            <p className="text-sm text-gray-500 mt-1 mb-5">เลือกยอดที่ใช้หักลบจากเป้าหมาย</p>
            <div className="space-y-2.5">
              {DEDUCT_OPTIONS.map(opt => (
                <button key={opt.mode} onClick={() => (isBasic ? generatePhaseBasic(modalPhase, opt.mode) : generatePhase(modalPhase, opt.mode))}
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

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={closePending}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-gray-900">
                {CHANNELS.find(c => c.key === pending.channel)?.label} · {SLOTS.find(s => s.key === pending.slot)?.label}
              </h2>
              <button onClick={closePending} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-4 truncate">{pending.file.name}</p>

            {pending.status === 'parsing' && (
              <p className="text-sm text-gray-500 py-6 text-center">กำลังอ่านไฟล์...</p>
            )}

            {pending.rows.length > 0 ? (
              <>
                <p className="font-semibold text-gray-800 text-sm mb-2">ตัวอย่างข้อมูล (5 แถวแรก)</p>
                <div className="overflow-x-auto max-h-80 border border-gray-100 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        {Object.keys(pending.rows[0]).map(c => (
                          <th key={c} className="px-3 py-2 text-left text-gray-600 font-medium border-b whitespace-nowrap">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pending.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          {Object.keys(pending.rows[0]).map(c => (
                            <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">{String(row[c] ?? '-')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pending.status === 'error' && (
                  <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mt-4">
                    <AlertCircle size={20} className="shrink-0" />{pending.message}
                  </div>
                )}
                <div className="flex justify-end gap-3 mt-5">
                  <button onClick={closePending} className="btn-secondary">ยกเลิก</button>
                  <button onClick={confirmPending} disabled={pending.status === 'submitting'} className="btn-primary">
                    {pending.status === 'submitting' ? 'กำลังบันทึก...' : 'ยืนยันอัพโหลด'}
                  </button>
                </div>
              </>
            ) : pending.status === 'error' && (
              <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
                <AlertCircle size={20} className="shrink-0" />{pending.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
