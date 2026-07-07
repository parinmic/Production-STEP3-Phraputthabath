'use client'
import { useState, useEffect, useCallback } from 'react'
import { CalendarDays, Search, Users, Weight } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface EmployeeRow {
  emp_id: string
  name: string
  department: string | null
  work_station: string | null
  shift: string | null
  is_weigher: boolean
  skills: Record<string, number> | null
}

interface Props {
  title: string
  stations: { slug: string; label: string }[]
  note?: string
}

// อ่านอย่างเดียว — ข้อมูลมาจาก employee_skills (sync จากภายนอกทุกวัน 08:05) ไม่มีการแก้ไขสถานะในหน้านี้แล้ว
export default function WorkforceStatusView({ title, stations, note }: Props) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]       = useState(today)
  const [station, setStation] = useState<string>('all')
  const [shift, setShift]     = useState<'all' | 'กะ 1' | 'กะ 2'>('all')
  const [search, setSearch]   = useState('')
  const [rows, setRows]       = useState<EmployeeRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('employee_skills')
      .select('emp_id, name, department, work_station, shift, is_weigher, skills')
      .eq('work_date', date)
      .order('work_station').order('name')
    setRows((data ?? []) as EmployeeRow[])
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  const stationLabel = (slug: string) => stations.find(s => s.slug === slug)?.label ?? slug

  const filtered = rows.filter(r => {
    if (station !== 'all' && r.work_station !== station) return false
    if (shift !== 'all' && r.shift !== shift) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-gray-500 mt-1 text-sm">ดูข้อมูลกำลังคนของวันที่เลือก (ข้อมูลจาก Sync อัตโนมัติ — ดูอย่างเดียว แก้ไขไม่ได้)</p>
        {note && (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs mt-2 inline-block">{note}</p>
        )}
      </div>

      <div className="card flex flex-wrap items-center gap-3">
        <CalendarDays size={18} className="text-blue-500 shrink-0" />
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

        <select value={station} onChange={e => setStation(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">ทุก Station</option>
          {stations.map(s => <option key={s.slug} value={s.slug}>{s.label}</option>)}
        </select>

        <select value={shift} onChange={e => setShift(e.target.value as typeof shift)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="all">ทุกกะ</option>
          <option value="กะ 1">กะ 1</option>
          <option value="กะ 2">กะ 2</option>
        </select>

        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          <Users size={16} className="text-gray-400" />
          <span className="font-semibold text-gray-900">{filtered.length}</span> คน
        </div>
      </div>

      {loading ? (
        <div className="card text-center py-12 text-gray-400">กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">ไม่พบข้อมูลกำลังคนของวันที่ {date}</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 w-12">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">ชื่อ</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Station</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">กะ</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">ชั่งน้ำหนัก</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">ทักษะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r, i) => (
                <tr key={`${r.emp_id}-${i}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                      {r.work_station ? stationLabel(r.work_station) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{r.shift || '—'}</td>
                  <td className="px-4 py-2.5">
                    {r.is_weigher && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
                        <Weight size={11} />ชั่งน้ำหนัก
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">
                    {Object.keys(r.skills ?? {}).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
