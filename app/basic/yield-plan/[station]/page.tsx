'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Calendar } from 'lucide-react'
import CarcassYieldPlanView from '../../production/[table]/carcass-yield-plan-view'

const STATION_MAP: Record<string, string> = {
  'sa-phok-basic':  'สะโพกเบสิค',
  'lai-basic':      'ไหล่เบสิค',
  'sam-chan-basic':  'สามชั้นเบสิค',
}

const PHASES = [
  { phase: 1 as const, label: 'Phase 1', sub: '8:30-14:30',       active: 'bg-blue-600 text-white border-blue-600',    inactive: 'border border-blue-300 text-blue-600 hover:bg-blue-50' },
  { phase: 2 as const, label: 'Phase 2', sub: '14:30-16:30',      active: 'bg-orange-500 text-white border-orange-500', inactive: 'border border-orange-300 text-orange-600 hover:bg-orange-50' },
  { phase: 3 as const, label: 'Phase 3', sub: '16:30 เป็นต้นไป', active: 'bg-red-500 text-white border-red-500',       inactive: 'border border-red-300 text-red-600 hover:bg-red-50' },
]

export default function YieldPlanStationPage() {
  const { station } = useParams() as { station: string }
  const stationName = STATION_MAP[station] ?? ''

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date,          setDate]          = useState(today)
  const [selectedPhase, setSelectedPhase] = useState<number | 'all'>(1)

  if (!stationName) {
    return <div className="p-8 text-gray-400">ไม่พบ Station นี้</div>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">แผนตาม Yield — {stationName}</h1>
      </div>

      {/* Phase + Date selectors */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSelectedPhase('all')}
          className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors border ${
            selectedPhase === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}>
          <span className="block">ทั้งหมด</span>
          <span className="block text-[10px] sm:text-xs font-normal opacity-80">3 Phase</span>
        </button>
        {PHASES.map(p => (
          <button key={p.phase}
            onClick={() => setSelectedPhase(p.phase)}
            className={`px-3 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
              selectedPhase === p.phase ? p.active : p.inactive
            }`}>
            <span className="block">{p.label}</span>
            <span className="block text-[10px] sm:text-xs font-normal opacity-80">{p.sub}</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-sm text-gray-700">
          <Calendar size={14} className="text-gray-400" />
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="outline-none bg-transparent text-sm"
          />
        </div>
      </div>

      {/* Yield Plan View */}
      <CarcassYieldPlanView
        selectedPhase={selectedPhase}
        date={date}
        stationName={stationName}
      />
    </div>
  )
}
