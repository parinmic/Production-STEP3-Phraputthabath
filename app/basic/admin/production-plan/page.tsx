'use client'
import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Pencil, Trash2, Check, X, AlertCircle } from 'lucide-react'

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

export default function ProductionPlanAdminPage() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]       = useState(today)
  const [rows, setRows]       = useState<PlanRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // inline edit state
  const [editId,     setEditId]     = useState<number | null>(null)
  const [editQty,    setEditQty]    = useState('')
  const [editWeight, setEditWeight] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/basic/admin/production-plan?date=${date}`)
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch {
      setError('โหลดข้อมูลไม่ได้')
    } finally {
      setLoading(false)
    }
  }, [date])

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
        <div className="ml-auto">
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>
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
    </div>
  )
}
