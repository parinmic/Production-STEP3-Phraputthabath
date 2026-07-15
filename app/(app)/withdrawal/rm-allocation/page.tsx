'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, ChevronRight, SkipForward, Camera } from 'lucide-react'
import type { RmAllocationResult, AllocationGroup, WipPhaseNeeds } from '@/app/api/withdrawal/rm-allocation/route'
import { todayBangkok } from '@/lib/date'

const PRIORITY_COLOR: Record<number, { label: string; color: string; bg: string; border: string }> = {
  1: { label: 'P1', color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  2: { label: 'P2', color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200' },
  3: { label: 'P3', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  4: { label: 'P4', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
}

const STATION_BADGE: Record<string, string> = {
  'สไลด์':   'bg-purple-100 text-purple-700',
  'สามชั้น': 'bg-blue-100   text-blue-700',
  'สะโพก':   'bg-orange-100 text-orange-700',
  'ไหล่':    'bg-green-100  text-green-700',
  'หมูบด':   'bg-red-100    text-red-700',
  'เผาขา':   'bg-fuchsia-100 text-fuchsia-700',
  'เลาะขา':  'bg-teal-100   text-teal-700',
}

const PHASE_LABEL: Record<number, { label: string; period: string; bg: string; text: string; border: string }> = {
  1: { label: 'Phase 1', period: 'เช้า',  bg: 'bg-blue-600',   text: 'text-white', border: 'border-blue-600' },
  2: { label: 'Phase 2', period: 'บ่าย',  bg: 'bg-amber-500',  text: 'text-white', border: 'border-amber-500' },
  3: { label: 'Phase 3', period: 'ค่ำ',   bg: 'bg-indigo-600', text: 'text-white', border: 'border-indigo-600' },
}

function pct(allocated: number, needed: number) {
  if (needed <= 0) return 100
  return Math.round((allocated / needed) * 100)
}

function BarCell({ allocated, needed }: { allocated: number; needed: number }) {
  const p     = pct(allocated, needed)
  const color = p >= 100 ? 'bg-green-500' : p >= 70 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-[60px]">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(p, 100)}%` }} />
      </div>
      <span className={`text-xs font-semibold w-8 text-right ${p >= 100 ? 'text-green-600' : p >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>{p}%</span>
    </div>
  )
}

function GroupCard({ group }: { group: AllocationGroup }) {
  const cfg          = PRIORITY_COLOR[group.priority] ?? PRIORITY_COLOR[2]
  const totalNeeded  = group.items.reduce((s, i) => s + i.needed_kg, 0)
  const totalAlloc   = group.items.reduce((s, i) => s + i.allocated_kg, 0)
  const totalShort   = group.items.reduce((s, i) => s + i.shortage_kg, 0)
  const hasShortage  = totalShort > 0.5
  const isSkipped    = !!group.skipped

  if (!isSkipped && group.items.length === 0) return null

  if (isSkipped) {
    return (
      <div className="card border border-dashed border-gray-200 bg-gray-50/60 opacity-70">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATION_BADGE[group.station] ?? 'bg-gray-100 text-gray-700'}`}>
            {group.station}
          </span>
          <span className="text-sm text-gray-400">{group.purpose}</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
            <SkipForward size={11} />
            {group.skipped}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={`card border-2 ${hasShortage ? 'border-red-400' : cfg.border}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATION_BADGE[group.station] ?? 'bg-gray-100 text-gray-700'}`}>
            {group.station}
          </span>
          <span className="text-sm text-gray-500">{group.purpose}</span>
        </div>
        {hasShortage && (
          <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded-full shrink-0">
            ขาด {Math.round(totalShort).toLocaleString()} กก.
          </span>
        )}
      </div>

      {group.items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">— ไม่มีรายการ (ไม่พบ BOM) —</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b text-xs">
              <th className="px-3 py-2 text-left   text-gray-500 font-medium">วัตถุดิบ</th>
              <th className="px-3 py-2 text-right  text-gray-500 font-medium">ต้องการ</th>
              <th className="px-3 py-2 text-right  text-gray-500 font-medium">จัดสรร</th>
              <th className="px-3 py-2 text-right  text-gray-500 font-medium hidden sm:table-cell">ขาด</th>
              <th className="px-3 py-2 text-left   text-gray-500 font-medium hidden md:table-cell w-36">สัดส่วน</th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((item, i) => (
              <tr key={i} className={`border-b last:border-0 ${item.shortage_kg > 0.5 ? 'bg-red-50/40' : ''}`}>
                <td className="px-3 py-2.5 font-medium text-gray-800">{item.raw_name}</td>
                <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{item.needed_kg.toLocaleString()}</td>
                <td className={`px-3 py-2.5 text-right font-semibold tabular-nums ${item.shortage_kg > 0.5 ? 'text-red-600' : 'text-gray-800'}`}>
                  {item.allocated_kg.toLocaleString()}
                </td>
                <td className={`px-3 py-2.5 text-right hidden sm:table-cell tabular-nums ${item.shortage_kg > 0.5 ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                  {item.shortage_kg > 0.5 ? item.shortage_kg.toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2.5 hidden md:table-cell">
                  <BarCell allocated={item.allocated_kg} needed={item.needed_kg} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <tr>
              <td className="px-3 py-2 text-xs font-semibold text-gray-500">รวม</td>
              <td className="px-3 py-2 text-right text-sm font-semibold text-gray-700 tabular-nums">{Math.round(totalNeeded).toLocaleString()}</td>
              <td className={`px-3 py-2 text-right text-sm font-bold tabular-nums ${hasShortage ? 'text-red-600' : 'text-green-600'}`}>{Math.round(totalAlloc).toLocaleString()}</td>
              <td className={`px-3 py-2 text-right text-sm font-bold hidden sm:table-cell tabular-nums ${hasShortage ? 'text-red-500' : 'text-gray-400'}`}>
                {hasShortage ? Math.round(totalShort).toLocaleString() : '—'}
              </td>
              <td className="hidden md:table-cell" />
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

type PhaseMatRow = { raw_name: string; needed_kg: number; allocated_kg: number; shortage_kg: number; isWipf?: boolean }
const normKey = (s: string) => s.trim().toLowerCase().replace(/\s*-\s*/g, '-')

export default function RmAllocationPage() {
  const today = todayBangkok()
  const [date, setDate]                 = useState(today)
  const [result, setResult]             = useState<RmAllocationResult | null>(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [snapshotSaving, setSnapshotSaving] = useState<number | null>(null)
  const [snapshotMsg, setSnapshotMsg]   = useState<{ phase: number; ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/withdrawal/rm-allocation?date=${date}`)
      const data = await res.json()
      if (!res.ok || data.error) { setError(data.error ?? 'เกิดข้อผิดพลาด'); return }
      setResult(data)
    } catch {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูล')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { load() }, [load])

  // Stock lookup by raw_name key (from summary — same stock regardless of phase)
  const stockByName = new Map<string, number>()
  for (const s of result?.summary ?? []) {
    stockByName.set(normKey(s.raw_name), s.total_stock)
  }

  // Per-phase combined summary: aggregate all items (pool + หมูบด private + WIP(F) in-house)
  const perPhaseSummary = [1, 2, 3].map(phase => {
    const rawMap = new Map<string, PhaseMatRow>()

    // Pool + หมูบด private ingredients (from allocation groups)
    for (const group of (result?.allocation ?? []).filter(g => g.phase === phase)) {
      for (const item of group.items) {
        const key = normKey(item.raw_name)
        const cur = rawMap.get(key) ?? { raw_name: item.raw_name, needed_kg: 0, allocated_kg: 0, shortage_kg: 0 }
        cur.needed_kg    += item.needed_kg
        cur.allocated_kg += item.allocated_kg
        cur.shortage_kg  += item.shortage_kg
        rawMap.set(key, cur)
      }
    }

    // WIP(F) in-house items: merge into same table (no warehouse allocation)
    const wipfItems = (result?.wipNeeds ?? []).find((w: WipPhaseNeeds) => w.phase === phase)?.items ?? []
    for (const item of wipfItems) {
      const key = normKey(item.raw_name ?? item.raw_sap)
      if (!rawMap.has(key)) {
        rawMap.set(key, { raw_name: item.raw_name ?? item.raw_sap, needed_kg: item.needed_kg, allocated_kg: 0, shortage_kg: 0, isWipf: true })
      } else {
        rawMap.get(key)!.needed_kg += item.needed_kg
      }
    }

    const allItems = Array.from(rawMap.values()).sort((a, b) => b.needed_kg - a.needed_kg)
    return { phase, allItems }
  }).filter(p => p.allItems.length > 0)

  // Group allocation by phase for the detailed GroupCards below
  const phaseGroups = result
    ? [1, 2, 3].map(phase => ({
        phase,
        groups: result.allocation.filter((g: AllocationGroup) => g.phase === phase),
      })).filter(p => p.groups.length > 0)
    : []

  const saveSnapshot = async (phase: number) => {
    const summary = perPhaseSummary.find(p => p.phase === phase)
    if (!summary || !date) return
    setSnapshotSaving(phase)
    try {
      const res  = await fetch('/api/withdrawal/rm-allocation/snapshot', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          date,
          phase,
          period: PHASE_LABEL[phase].period,
          raw_materials: summary.allItems,
          wipf_items:    [],
        }),
      })
      const data = await res.json()
      setSnapshotMsg({ phase, ok: res.ok, msg: res.ok ? 'บันทึก Snapshot สำเร็จ' : (data.error ?? 'เกิดข้อผิดพลาด') })
      setTimeout(() => setSnapshotMsg(null), 3000)
    } finally {
      setSnapshotSaving(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Link href="/withdrawal/1" className="hover:text-gray-600">รายการเบิก</Link>
            <ChevronRight size={14} />
            <span className="text-gray-600">จัดสรรเนื้อ Raw Mat</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">จัดสรรเนื้อ Raw Mat</h1>
          <p className="text-gray-500 mt-1 text-sm hidden sm:block">แบ่งวัตถุดิบไปแต่ละ Station ตาม Priority — Phase 1 / 2 / 3</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 btn-secondary text-sm py-1.5 px-3"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          คำนวณใหม่
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">{error}</div>
      )}

      {loading && (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
          <p>กำลังคำนวณการจัดสรร...</p>
        </div>
      )}

      {!loading && result?.message && (
        <div className="card text-center py-10 text-gray-500">{result.message}</div>
      )}

      {!loading && result && !result.message && (
        <div className="space-y-8">

          {/* ── Per-phase combined summary ── */}
          <div className="space-y-6">
            {perPhaseSummary.map(({ phase, allItems }) => {
              const ph          = PHASE_LABEL[phase]
              const totalNeeded = allItems.reduce((s, r) => s + r.needed_kg, 0)
              const totalAlloc  = allItems.reduce((s, r) => s + r.allocated_kg, 0)
              const totalShort  = allItems.reduce((s, r) => s + r.shortage_kg, 0)
              const isSaving    = snapshotSaving === phase

              return (
                <div key={phase} className={`card border-2 ${totalShort > 0.5 ? 'border-red-300' : 'border-gray-100'}`}>
                  {/* Phase header */}
                  <div className="flex items-center gap-3 mb-5 flex-wrap">
                    <span className={`${ph.bg} ${ph.text} text-sm font-bold px-3 py-1 rounded-lg`}>{ph.label}</span>
                    <span className="text-sm text-gray-500">{ph.period}</span>
                    <div className="flex-1 h-px bg-gray-200 min-w-[20px]" />
                    {totalShort > 0.5 && (
                      <span className="text-xs text-red-600 font-medium bg-red-50 px-2 py-0.5 rounded-full">
                        ขาด {Math.round(totalShort).toLocaleString()} กก.
                      </span>
                    )}
                    <button
                      onClick={() => saveSnapshot(phase)}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Camera size={12} className={isSaving ? 'animate-pulse' : ''} />
                      {isSaving ? 'กำลังบันทึก...' : 'Snapshot'}
                    </button>
                  </div>

                  {snapshotMsg?.phase === phase && (
                    <div className={`mb-4 text-sm px-3 py-2 rounded-lg ${snapshotMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                      {snapshotMsg.msg}
                    </div>
                  )}

                  {/* Unified materials table: pool raw + หมูบด private + WIP(F) in-house */}
                  {allItems.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b text-xs">
                            <th className="px-3 py-2 text-left  text-gray-500 font-medium">วัตถุดิบ</th>
                            <th className="px-3 py-2 text-right text-gray-500 font-medium">Stock (กก.)</th>
                            <th className="px-3 py-2 text-right text-gray-500 font-medium">ต้องการ</th>
                            <th className="px-3 py-2 text-right text-gray-500 font-medium">จัดสรร</th>
                            <th className="px-3 py-2 text-right text-gray-500 font-medium hidden sm:table-cell">ขาด</th>
                            <th className="px-3 py-2 text-center text-gray-500 font-medium">สถานะ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allItems.map((item, i) => {
                            const stock    = stockByName.get(normKey(item.raw_name)) ?? 0
                            const hasShort = item.shortage_kg > 0.5
                            if (item.isWipf) {
                              return (
                                <tr key={i} className="border-b last:border-0 bg-purple-50/20">
                                  <td className="px-3 py-2.5 font-medium text-gray-800">{item.raw_name}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-400">—</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-purple-700 font-semibold">{item.needed_kg.toLocaleString()}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-400">—</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell text-gray-300">—</td>
                                  <td className="px-3 py-2.5 text-center">
                                    <span className="inline-block text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">ต้องผลิต</span>
                                  </td>
                                </tr>
                              )
                            }
                            return (
                              <tr key={i} className={`border-b last:border-0 ${hasShort ? 'bg-red-50/40' : ''}`}>
                                <td className="px-3 py-2.5 font-medium text-gray-800">{item.raw_name}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{Math.round(stock).toLocaleString()}</td>
                                <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{item.needed_kg.toLocaleString()}</td>
                                <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${hasShort ? 'text-red-600' : 'text-gray-800'}`}>
                                  {item.allocated_kg.toLocaleString()}
                                </td>
                                <td className={`px-3 py-2.5 text-right tabular-nums hidden sm:table-cell font-semibold ${hasShort ? 'text-red-500' : 'text-gray-300'}`}>
                                  {hasShort ? Math.round(item.shortage_kg).toLocaleString() : '—'}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  {hasShort
                                    ? <span className="inline-block text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">ขาด</span>
                                    : <span className="inline-block text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">เพียงพอ</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                          <tr>
                            <td className="px-3 py-2 text-xs font-semibold text-gray-500" colSpan={2}>รวม</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-700">{Math.round(totalNeeded).toLocaleString()}</td>
                            <td className={`px-3 py-2 text-right font-bold tabular-nums ${totalShort > 0.5 ? 'text-red-600' : 'text-green-600'}`}>{Math.round(totalAlloc).toLocaleString()}</td>
                            <td className={`px-3 py-2 text-right font-bold tabular-nums hidden sm:table-cell ${totalShort > 0.5 ? 'text-red-500' : 'text-gray-300'}`}>
                              {totalShort > 0.5 ? Math.round(totalShort).toLocaleString() : '—'}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Detailed allocation groups per phase ── */}
          {phaseGroups.map(({ phase, groups }) => {
            const ph = PHASE_LABEL[phase]
            return (
              <div key={phase}>
                <div className="flex items-center gap-3 mb-4">
                  <span className={`${ph.bg} ${ph.text} text-sm font-bold px-3 py-1 rounded-lg`}>{ph.label}</span>
                  <span className="text-sm text-gray-400">{ph.period}</span>
                  <span className="text-xs text-gray-400">รายละเอียดการจัดสรร</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
                <div className="space-y-4">
                  {groups.map((group: AllocationGroup, i: number) => (
                    <GroupCard key={i} group={group} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
