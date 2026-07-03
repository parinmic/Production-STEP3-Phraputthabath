'use client'
import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Pencil, Trash2, Check, X, AlertCircle, AlertTriangle, Plus } from 'lucide-react'

const PERIODS = ['เช้า', 'บ่าย', 'ค่ำ']
const PERIOD_PHASE: Record<string, string> = { เช้า: 'Phase 1', บ่าย: 'Phase 2', ค่ำ: 'Phase 3' }
const STATIONS_ALL = [
  'สายพานสะโพก',
  'สายพานไหล่',
  'สายพานสามชั้น',
  'กลุ่ม เครื่องใน',
  'กลุ่ม บด หั่นแกง',
  'กลุ่ม เผา ,เลาะ',
  'กลุ่ม สไลด์',
]

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
function formatThaiDate(dateStr?: string): string {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const d = parseInt(parts[2], 10)
  const m = parseInt(parts[1], 10)
  return `${d} ${THAI_MONTHS[m - 1]}`
}

interface PlanRow {
  id: number
  plan_date: string
  station: string
  seq: number | null
  step: string | null
  unix_code: string | null
  sap: string
  product_name: string | null
  weight_per_bag: number
  qty_bags: number
  weight_total: number
  lotus_bags: number
  lotus_weight: number
  cpft_bags: number
  cpft_weight: number
  makro_bags: number
  makro_weight: number
  period: string | null
  qty_d3: number
  qty_d2: number
  qty_d1: number
}

const STATION_COLOR: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  'สายพานสะโพก':   { border: 'border-orange-300', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  'สายพานไหล่':    { border: 'border-green-300',  bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-400'  },
  'สายพานสามชั้น': { border: 'border-blue-300',   bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-400'   },
}

function stationColor(station: string) {
  for (const key of Object.keys(STATION_COLOR)) {
    if (station.includes(key.replace('สายพาน', ''))) return STATION_COLOR[key]
  }
  return { border: 'border-gray-200', bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' }
}

function fmt(n: number) {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 2 })
}

const EMPTY_FORM = {
  plan_date: '',
  station: STATIONS_ALL[0],
  sap: '',
  product_name: '',
  weight_per_bag: '',
  qty_bags: '',
  weight_total: '',
  period: 'เช้า',
}

export default function ProductionPlanAdminPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]       = useState(today)
  const [period, setPeriod]   = useState('')
  const [rows, setRows]       = useState<PlanRow[]>([])
  const [histDates, setHistDates] = useState<{ d3: string; d2: string; d1: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // inline edit state
  const [editId,     setEditId]     = useState<number | null>(null)
  const [editQty,    setEditQty]    = useState('')
  const [editWeight, setEditWeight] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // add-SKU modal state
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm]       = useState({ ...EMPTY_FORM, plan_date: today })
  const [addSaving, setAddSaving] = useState(false)

  // bulk delete state
  const [confirmBulk, setConfirmBulk] = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/basic/admin/production-plan?date=${date}`
      if (period) url += `&period=${period}`
      const res  = await fetch(url)
      const data = await res.json()
      setRows(data.rows ?? [])
      setHistDates(data.dates ?? null)
    } catch {
      setError('โหลดข้อมูลไม่ได้')
    } finally {
      setLoading(false)
    }
  }, [date, period])

  useEffect(() => { fetchRows() }, [fetchRows])

  function startEdit(row: PlanRow) {
    setEditId(row.id)
    setEditQty(String(row.qty_bags))
    setEditWeight(String(row.weight_total))
  }

  function cancelEdit() {
    setEditId(null)
    setEditQty('')
    setEditWeight('')
  }

  async function saveEdit(id: number) {
    setSaving(true)
    try {
      const res  = await fetch('/api/basic/admin/production-plan', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id, qty_bags: Number(editQty), weight_total: Number(editWeight) }),
      })
      const data = await res.json()
      if (!data.success) { setError(data.message); return }
      cancelEdit()
      fetchRows()
    } catch {
      setError('บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('ลบรายการนี้?')) return
    setDeletingId(id)
    try {
      await fetch(`/api/basic/admin/production-plan?id=${id}`, { method: 'DELETE' })
      fetchRows()
    } finally {
      setDeletingId(null) }
  }

  async function deletePeriod(p: string) {
    const res = await fetch('/api/basic/admin/production-plan', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, period: p }),
    })
    const data = await res.json()
    if (!data.success) { setError(data.message); return }
    setConfirmBulk(null)
    fetchRows()
  }

  async function handleAdd() {
    setAddSaving(true)
    try {
      const res = await fetch('/api/basic/admin/production-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          weight_per_bag: Number(form.weight_per_bag || 0),
          qty_bags: Number(form.qty_bags || 0),
          weight_total: Number(form.weight_total || 0),
          product_name: form.product_name || null,
        }),
      })
      const data = await res.json()
      if (!data.success) { setError(data.message); return }
      setShowAdd(false)
      setForm({ ...EMPTY_FORM, plan_date: date })
      fetchRows()
    } finally {
      setAddSaving(false)
    }
  }

  function updateForm(patch: Partial<typeof EMPTY_FORM>) {
    setForm(f => {
      const next = { ...f, ...patch }
      const wpb = Number(next.weight_per_bag || 0)
      const qty = Number(next.qty_bags || 0)
      if (('weight_per_bag' in patch || 'qty_bags' in patch) && wpb > 0 && qty > 0) {
        next.weight_total = String(wpb * qty)
      }
      return next
    })
  }

  // group by station
  const stations = [...new Set(rows.map(r => r.station))]
  const totalQty    = rows.reduce((s, r) => s + r.qty_bags, 0)
  const totalWeight = rows.reduce((s, r) => s + r.weight_total, 0)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
          <ShieldAlert size={20} className="text-red-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">จัดการแผนผลิต</h1>
          <p className="text-xs text-gray-500">แก้ไข / ลบรายการในแผนผลิต 100% ของวันที่เลือก</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={period} onChange={e => setPeriod(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            <option value="">ทั้งหมด</option>
            {PERIODS.map(p => <option key={p} value={p}>{p} ({PERIOD_PHASE[p]})</option>)}
          </select>
          <input
            type="date" value={date} onChange={e => { setDate(e.target.value); setForm(f => ({ ...f, plan_date: e.target.value })) }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <button
            onClick={() => { setForm({ ...EMPTY_FORM, plan_date: date, period: period || 'เช้า' }); setShowAdd(true) }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
            <Plus size={16} />เพิ่ม SKU
          </button>
        </div>
      </div>

      {/* Delete phase buttons */}
      <div className="flex flex-wrap gap-3">
        {PERIODS.map(p => (
          <button key={p} onClick={() => setConfirmBulk(p)}
            className="flex items-center gap-2 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg text-sm font-medium">
            <Trash2 size={14} />ลบ {PERIOD_PHASE[p]} ({p}) ทั้งหมด
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-200">
          <AlertCircle size={16} />{error}
          <button className="ml-auto text-red-400 hover:text-red-600" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {/* Summary bar */}
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500">รายการทั้งหมด</p>
            <p className="text-xl font-bold text-gray-900">{rows.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500">รวมจำนวน (ถุง)</p>
            <p className="text-xl font-bold text-blue-700">{fmt(totalQty)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500">รวมน้ำหนัก (กก.)</p>
            <p className="text-xl font-bold text-emerald-700">{fmt(totalWeight)}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm bg-white rounded-2xl border border-gray-200">
          ไม่มีข้อมูลแผนผลิตวันที่ {new Date(date + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      ) : (
        <div className="space-y-4">
          {stations.map(station => {
            const stRows = rows.filter(r => r.station === station)
            const c = stationColor(station)
            const stQty    = stRows.reduce((s, r) => s + r.qty_bags, 0)
            const stWeight = stRows.reduce((s, r) => s + r.weight_total, 0)
            return (
              <div key={station} className={`bg-white rounded-2xl border ${c.border} shadow-sm overflow-hidden`}>
                {/* Station header */}
                <div className={`px-4 py-2.5 ${c.bg} border-b ${c.border} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                    <span className={`text-sm font-bold ${c.text}`}>{station}</span>
                    <span className="text-xs text-gray-400">({stRows.length} รายการ)</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{fmt(stQty)} ถุง</span>
                    <span>{fmt(stWeight)} กก.</span>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                        <th className="text-left px-3 py-2 font-medium w-8">Seq</th>
                        <th className="text-left px-3 py-2 font-medium">SAP / ชื่อสินค้า</th>
                        <th className="text-right px-3 py-2 font-medium">กก./ถุง</th>
                        <th className="text-right px-3 py-2 font-medium">จำนวน (ถุง)</th>
                        <th className="text-right px-3 py-2 font-medium">น้ำหนักรวม (กก.)</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-400">{formatThaiDate(histDates?.d3)}</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-400">{formatThaiDate(histDates?.d2)}</th>
                        <th className="text-right px-3 py-2 font-medium text-gray-400">{formatThaiDate(histDates?.d1)}</th>
                        <th className="text-right px-3 py-2 font-medium">Makro</th>
                        <th className="text-right px-3 py-2 font-medium">LOTUS</th>
                        <th className="text-right px-3 py-2 font-medium">CPFT</th>
                        <th className="px-3 py-2 w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {stRows.map(row => {
                        const isEditing = editId === row.id
                        return (
                          <tr key={row.id} className={isEditing ? 'bg-yellow-50' : 'hover:bg-gray-50 transition-colors'}>
                            <td className="px-3 py-2.5 text-gray-400 text-xs">{row.seq ?? '—'}</td>
                            <td className="px-3 py-2.5">
                              <div className="font-mono text-xs text-gray-500">{row.sap}</div>
                              <div className="text-sm text-gray-800">{row.product_name ?? '—'}</div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-600">{fmt(row.weight_per_bag)}</td>
                            <td className="px-3 py-2.5 text-right">
                              {isEditing ? (
                                <input
                                  type="number" value={editQty} onChange={e => setEditQty(e.target.value)}
                                  className="w-20 text-right text-sm border border-yellow-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                                />
                              ) : (
                                <span className="font-semibold text-gray-800">{fmt(row.qty_bags)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {isEditing ? (
                                <input
                                  type="number" value={editWeight} onChange={e => setEditWeight(e.target.value)}
                                  className="w-24 text-right text-sm border border-yellow-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-yellow-400"
                                />
                              ) : (
                                <span className="font-semibold text-emerald-700">{fmt(row.weight_total)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-400 font-normal">
                              {row.qty_d3 > 0 ? Math.round(row.qty_d3).toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-400 font-normal">
                              {row.qty_d2 > 0 ? Math.round(row.qty_d2).toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-400 font-normal">
                              {row.qty_d1 > 0 ? Math.round(row.qty_d1).toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right text-xs text-gray-500">{fmt(row.makro_bags)}</td>
                            <td className="px-3 py-2.5 text-right text-xs text-gray-500">{fmt(row.lotus_bags)}</td>
                            <td className="px-3 py-2.5 text-right text-xs text-gray-500">{fmt(row.cpft_bags)}</td>
                            <td className="px-3 py-2.5">
                              {isEditing ? (
                                <div className="flex items-center gap-1 justify-end">
                                  <button
                                    onClick={() => saveEdit(row.id)} disabled={saving}
                                    className="p-1.5 text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-50"
                                    title="บันทึก">
                                    <Check size={13} />
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                    title="ยกเลิก">
                                    <X size={13} />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 justify-end">
                                  <button
                                    onClick={() => startEdit(row)}
                                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="แก้ไข">
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(row.id)} disabled={deletingId === row.id}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                                    title="ลบ">
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm bulk delete */}
      {confirmBulk && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle size={24} />
              <h2 className="text-lg font-bold">ยืนยันการลบ?</h2>
            </div>
            <p className="text-gray-600 text-sm">
              ลบแผนผลิต 100% <strong>{PERIOD_PHASE[confirmBulk]} ({confirmBulk})</strong> วันที่ {date} ทั้งหมด
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmBulk(null)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button onClick={() => deletePeriod(confirmBulk)}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">
                ลบทั้งหมด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add SKU modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">เพิ่ม SKU</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 mb-1 block">วันที่ผลิต</label>
                <input type="date" value={form.plan_date}
                  onChange={e => updateForm({ plan_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Phase (รอบ)</label>
                <select value={form.period} onChange={e => updateForm({ period: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {PERIODS.map(p => <option key={p} value={p}>{p} ({PERIOD_PHASE[p]})</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Station</label>
                <select value={form.station} onChange={e => updateForm({ station: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {STATIONS_ALL.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">SAP</label>
                <input value={form.sap} onChange={e => updateForm({ sap: e.target.value })}
                  placeholder="23070475"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">กก./ถุง</label>
                <input type="number" min="0" value={form.weight_per_bag}
                  onChange={e => updateForm({ weight_per_bag: e.target.value })}
                  placeholder="10"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 mb-1 block">ชื่อสินค้า (ไม่บังคับ)</label>
                <input value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                  placeholder="สามชั้นหมูตัดเส้น 3-4 นิ้ว"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">จำนวนถุง</label>
                <input type="number" min="0" value={form.qty_bags}
                  onChange={e => updateForm({ qty_bags: e.target.value })}
                  placeholder="50"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">น้ำหนักรวม (กก.)</label>
                <input type="number" min="0" value={form.weight_total}
                  onChange={e => setForm(f => ({ ...f, weight_total: e.target.value }))}
                  placeholder="500"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button onClick={handleAdd} disabled={addSaving || !form.plan_date || !form.station || !form.sap}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
                {addSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
