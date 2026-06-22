'use client'
import { useState, useEffect } from 'react'
import { RefreshCw, Thermometer, CheckCircle2, XCircle, PlayCircle } from 'lucide-react'

interface LotRow {
  spec_code: string
  qty_3:     number
  weight_3:  number
}

interface TempRecord {
  start: string
  mid:   string
  end:   string
}

const EMPTY_TEMP: TempRecord = { start: '', mid: '', end: '' }

function parseNum(v: string): number | null {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

function calcAvg(t: TempRecord): number | null {
  const vals = [parseNum(t.start), parseNum(t.mid), parseNum(t.end)].filter((v): v is number => v !== null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function tempStatus(avg: number | null): 'green' | 'red' | 'none' {
  if (avg === null) return 'none'
  return avg >= 4 && avg <= 7 ? 'green' : 'red'
}

function TempInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="—"
      className="w-20 text-right text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
    />
  )
}

export default function TemperatureCheckPage() {
  const [rows,       setRows]       = useState<LotRow[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [sourceFile, setSourceFile] = useState('')
  const [generated,  setGenerated]  = useState(false)
  const [temps,      setTemps]      = useState<Record<string, TempRecord>>({})

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      const savedTemps = localStorage.getItem('qc_temps_3pt')
      const savedRows  = localStorage.getItem('qc_rows')
      const savedFile  = localStorage.getItem('qc_source_file')
      if (savedTemps) setTemps(JSON.parse(savedTemps))
      if (savedRows)  { setRows(JSON.parse(savedRows)); setGenerated(true) }
      if (savedFile)  setSourceFile(savedFile)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { localStorage.setItem('qc_temps_3pt', JSON.stringify(temps)) }, [temps])
  useEffect(() => { localStorage.setItem('qc_rows', JSON.stringify(rows)) }, [rows])
  useEffect(() => { localStorage.setItem('qc_source_file', sourceFile) }, [sourceFile])

  async function generate() {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/pig-carcass-withdrawal')
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      const sorted: LotRow[] = (json.rows as LotRow[])
        .filter(r => r.qty_3 > 0)
        .sort((a, b) => a.spec_code.slice(-1).localeCompare(b.spec_code.slice(-1)))
      setRows(sorted)
      setSourceFile(json.source_file ?? '')
      setGenerated(true)
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }

  function setField(spec: string, field: keyof TempRecord, value: string) {
    setTemps(prev => ({ ...prev, [spec]: { ...(prev[spec] ?? EMPTY_TEMP), [field]: value } }))
  }

  const filledRows = rows.filter(r => { const t = temps[r.spec_code]; return t && (t.start || t.mid || t.end) })
  const goodCount  = filledRows.filter(r => tempStatus(calcAvg(temps[r.spec_code] ?? EMPTY_TEMP)) === 'green').length
  const badCount   = filledRows.filter(r => tempStatus(calcAvg(temps[r.spec_code] ?? EMPTY_TEMP)) === 'red').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Thermometer size={24} className="text-cyan-500" />
            ตรวจอุณหภูมิ (QC)
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Lot หมูซีก จาก Stock คลัง 20 — รหัสสินค้า 90007</p>
          {sourceFile && <p className="text-xs text-gray-400 mt-0.5">ไฟล์ล่าสุด: {sourceFile}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {generated && (
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              รีโหลด
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <PlayCircle size={16} />
            Generate
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-14 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังดึงข้อมูล Lot...</p>
        </div>
      )}

      {/* Initial state */}
      {!loading && !generated && (
        <div className="text-center py-20 text-gray-400">
          <Thermometer size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">กด <span className="font-semibold text-cyan-600">Generate</span> เพื่อดึงข้อมูล Lot หมูซีก</p>
        </div>
      )}

      {/* No lots */}
      {!loading && generated && rows.length === 0 && !error && (
        <div className="text-center py-14 text-gray-400">
          <p>ไม่พบข้อมูล — กรุณาอัพโหลดไฟล์ Stock คลัง 20 ก่อน</p>
        </div>
      )}

      {/* Summary */}
      {!loading && rows.length > 0 && (
        <div className="rounded-xl border bg-gray-50 border-gray-200 px-5 py-4 flex flex-wrap gap-6 items-center">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">Lot ทั้งหมด</p>
            <p className="text-2xl font-bold text-gray-700">{rows.length} <span className="text-sm font-normal">ล็อต</span></p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-0.5">กรอกแล้ว</p>
            <p className={`text-2xl font-bold ${filledRows.length > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
              {filledRows.length} <span className="text-sm font-normal">ล็อต</span>
            </p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={18} className={goodCount > 0 ? 'text-green-500' : 'text-gray-300'} />
              <div>
                <p className="text-xs text-gray-500">เฉลี่ยเหมาะสม (4–7 °C)</p>
                <p className={`text-xl font-bold leading-tight ${goodCount > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                  {goodCount} <span className="text-sm font-normal">ล็อต</span>
                </p>
              </div>
            </div>
            {badCount > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle size={18} className="text-red-400" />
                <div>
                  <p className="text-xs text-gray-500">เฉลี่ยไม่เหมาะสม</p>
                  <p className="text-xl font-bold leading-tight text-red-500">
                    {badCount} <span className="text-sm font-normal">ล็อต</span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {!loading && rows.length > 0 && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-400 w-8">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Lot</th>
                  <th className="px-4 py-3 text-right font-semibold text-blue-700">
                    <div>จำนวน</div><div className="font-normal text-blue-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-emerald-700">
                    <div>น้ำหนักเฉลี่ย</div><div className="font-normal text-emerald-400">(กก./ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิต้น Lot</div><div className="font-normal text-cyan-400">(°C)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิกลาง Lot</div><div className="font-normal text-cyan-400">(°C)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-cyan-700">
                    <div>อุณหภูมิท้าย Lot</div><div className="font-normal text-cyan-400">(°C)</div>
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-indigo-700">
                    <div>เฉลี่ย</div><div className="font-normal text-indigo-400">(°C)</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => {
                  const avg    = r.qty_3 > 0 ? r.weight_3 / r.qty_3 : 0
                  const t      = temps[r.spec_code] ?? EMPTY_TEMP
                  const tAvg   = calcAvg(t)
                  const status = tempStatus(tAvg)
                  const rowBg  = status === 'green' ? 'bg-green-50' : status === 'red' ? 'bg-red-50' : 'hover:bg-gray-50'
                  return (
                    <tr key={r.spec_code} className={`transition-colors ${rowBg}`}>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{r.spec_code}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">{r.qty_3.toLocaleString('th-TH')}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">
                        {avg > 0 ? avg.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <TempInput value={t.start} onChange={v => setField(r.spec_code, 'start', v)} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <TempInput value={t.mid} onChange={v => setField(r.spec_code, 'mid', v)} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <TempInput value={t.end} onChange={v => setField(r.spec_code, 'end', v)} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {tAvg !== null ? (
                          <span className={`font-bold text-sm ${status === 'green' ? 'text-green-600' : status === 'red' ? 'text-red-500' : 'text-gray-500'}`}>
                            {tAvg.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                            {status === 'green' && <span className="ml-1 text-xs font-normal">✓</span>}
                            {status === 'red'   && <span className="ml-1 text-xs font-normal">✗</span>}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
