'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { RefreshCw, ChevronRight, SkipForward } from 'lucide-react'
import type { RmAllocationResult, AllocationGroup } from '@/app/api/withdrawal/rm-allocation/route'

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
}

const PHASE_LABEL: Record<number, { label: string; period: string; bg: string; text: string; border: string }> = {
  1: { label: 'Phase 1', period: 'เช้า',  bg: 'bg-blue-600',  text: 'text-white', border: 'border-blue-600' },
  2: { label: 'Phase 2', period: 'บ่าย',  bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-500' },
  3: { label: 'Phase 3', period: 'ค่ำ',   bg: 'bg-indigo-600',text: 'text-white', border: 'border-indigo-600' },
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
        <>
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
        </>
      )}
    </div>
  )
}

export default function RmAllocationPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]           = useState(today)
  const [result, setResult]       = useState<RmAllocationResult | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(true)

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

  const totalRaw       = result?.summary.reduce((s, r) => s + r.total_stock, 0)       ?? 0
  const totalAllocated = result?.summary.reduce((s, r) => s + r.total_allocated, 0)   ?? 0

  // Group allocation by phase
  const phaseGroups = result
    ? [1, 2, 3].map(phase => ({
        phase,
        groups: result.allocation.filter(g => g.phase === phase),
      })).filter(p => p.groups.length > 0)
    : []

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

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
          <p>กำลังคำนวณการจัดสรร...</p>
        </div>
      )}

      {/* No data */}
      {!loading && result?.message && (
        <div className="card text-center py-10 text-gray-500">{result.message}</div>
      )}

      {/* Main content */}
      {!loading && result && !result.message && (
        <div className="space-y-8">

          {/* Summary */}
          <div className="card">
            <button
              onClick={() => setShowSummary(s => !s)}
              className="w-full flex items-center justify-between text-left"
            >
              <div>
                <h2 className="font-semibold text-gray-900">สรุปวัตถุดิบรวม (ทุก Phase)</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Stock รวม {Math.round(totalRaw).toLocaleString()} กก. · จัดสรร {Math.round(totalAllocated).toLocaleString()} กก. · คงเหลือ {Math.round(totalRaw - totalAllocated).toLocaleString()} กก.
                </p>
              </div>
              <ChevronRight size={16} className={`text-gray-400 transition-transform ${showSummary ? 'rotate-90' : ''}`} />
            </button>

            {showSummary && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b text-xs">
                      <th className="px-3 py-2 text-left   text-gray-500 font-medium">วัตถุดิบ</th>
                      <th className="px-3 py-2 text-right  text-gray-500 font-medium">Stock รวม (กก.)</th>
                      <th className="px-3 py-2 text-right  text-gray-500 font-medium">จัดสรรแล้ว</th>
                      <th className="px-3 py-2 text-right  text-gray-500 font-medium">คงเหลือ</th>
                      <th className="px-3 py-2 text-left   text-gray-500 font-medium hidden md:table-cell w-36">ใช้ไป</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.summary.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2.5 font-medium text-gray-800">{row.raw_name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{row.total_stock.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-800">{row.total_allocated.toLocaleString()}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${row.remaining < 0.5 ? 'text-gray-400' : 'text-green-600'}`}>
                          {row.remaining.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          <BarCell allocated={row.total_allocated} needed={row.total_stock} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 bg-gray-50">
                    <tr>
                      <td className="px-3 py-2 text-xs font-semibold text-gray-500">รวม</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{Math.round(totalRaw).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-800">{Math.round(totalAllocated).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-green-600">{Math.round(totalRaw - totalAllocated).toLocaleString()}</td>
                      <td className="hidden md:table-cell" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Phase sections */}
          {phaseGroups.map(({ phase, groups }) => {
            const ph = PHASE_LABEL[phase]
            return (
              <div key={phase}>
                {/* Phase header */}
                <div className="flex items-center gap-3 mb-4">
                  <span className={`${ph.bg} ${ph.text} text-sm font-bold px-3 py-1 rounded-lg`}>{ph.label}</span>
                  <span className="text-sm text-gray-400">{ph.period}</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>

                <div className="space-y-4">
                  {groups.map((group, i) => (
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
