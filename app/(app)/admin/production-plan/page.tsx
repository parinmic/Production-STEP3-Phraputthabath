'use client'
import { useState, useEffect, useCallback } from 'react'
import { Calendar, RefreshCw, Trash2, Plus, X, AlertTriangle, Pencil, Check, Zap } from 'lucide-react'
import { useCanEdit } from '@/lib/session-context'

const PERIODS = ['เช้า', 'บ่าย', 'ค่ำ']
const PERIOD_PHASE: Record<string, string> = { เช้า: 'Phase 1', บ่าย: 'Phase 2', ค่ำ: 'Phase 3' }
const STATIONS  = ['สามชั้น', 'สะโพก', 'ไหล่', 'หมูบด', 'สไลด์']
const CHANNELS  = ['Makro', 'Wet Market', 'LOTUS']

const STATION_COLOR: Record<string, string> = {
  สามชั้น: 'bg-blue-50 text-blue-700',
  สะโพก:   'bg-orange-50 text-orange-700',
  ไหล่:    'bg-green-50 text-green-700',
  หมูบด:   'bg-red-50 text-red-700',
  สไลด์:   'bg-purple-50 text-purple-700',
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
function formatThaiDate(dateStr?: string): string {
  if (!dateStr) return '—'
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const d = parseInt(parts[2], 10)
  const m = parseInt(parts[1], 10)
  return `${d} ${THAI_MONTHS[m - 1]}`
}

interface SkuRow {
  channel: string | null
  table_name: string
  sku: string
  sku_name: string | null
  qty_d3: number
  qty_d2: number
  qty_d1: number
  total_qty: number
}

const EMPTY_FORM = {
  production_date: '',
  table_name: 'สามชั้น',
  sku: '',
  sku_name: '',
  target_quantity: '',
  period: 'เช้า',
  channel: 'Makro',
}

export default function AdminProductionPlanPage() {
  const canEdit = useCanEdit('11')
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const [date, setDate]           = useState(today)
  const [period, setPeriod]       = useState<string>('')
  const [rows, setRows]           = useState<SkuRow[]>([])
  const [histDates, setHistDates] = useState<{ d3: string; d2: string; d1: string } | null>(null)
  const [loading, setLoading]     = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [form, setForm]           = useState({ ...EMPTY_FORM, production_date: today })
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmBulk, setConfirmBulk] = useState<string | null>(null)
  const [editKey, setEditKey]     = useState<string | null>(null)
  const [editVal, setEditVal]     = useState<string>('')
  const [confirmEmergency, setConfirmEmergency] = useState(false)
  const [generating, setGenerating] = useState(false)

  const rowKey = (r: SkuRow) => `${r.channel ?? ''}||${r.table_name}||${r.sku}`

  const load = useCallback(async () => {
    setLoading(true)
    setEditKey(null)
    try {
      let url = `/api/admin/production-plan?date=${date}`
      if (period) url += `&period=${period}`
      const r = await fetch(url)
      const j = await r.json()
      setRows(j.data ?? [])
      setHistDates(j.dates ?? null)
    } finally {
      setLoading(false)
    }
  }, [date, period])

  useEffect(() => { load() }, [load])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const startEdit = (r: SkuRow) => {
    setEditKey(rowKey(r))
    setEditVal(String(Math.round(r.total_qty)))
  }

  const saveEdit = async (r: SkuRow) => {
    const new_qty = Number(editVal)
    if (isNaN(new_qty) || new_qty < 0) { flash(false, 'ตัวเลขไม่ถูกต้อง'); return }
    const res = await fetch('/api/admin/production-plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, table_name: r.table_name, sku: r.sku, channel: r.channel, new_qty }),
    })
    const j = await res.json()
    if (j.error) { flash(false, j.error); return }
    flash(true, `อัพเดท ${r.sku_name ?? r.sku} (${r.channel ?? '—'}) → ${new_qty.toLocaleString()} กก.`)
    setEditKey(null)
    load()
  }

  const deletePeriod = async (period: string) => {
    const res = await fetch('/api/admin/production-plan', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, period }),
    })
    const j = await res.json()
    if (j.error) { flash(false, j.error); return }
    flash(true, `ลบ ${PERIOD_PHASE[period]} (${period}) ทั้งหมด ${j.deleted} รายการแล้ว`)
    setConfirmBulk(null)
    load()
  }

  const generateEmergencyPlan = async () => {
    setGenerating(true)
    try {
      const res = await fetch('/api/production/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          phase: 1,
          deductMode: 'plan',
          disableMidRecal: true,
          useFallbackWorkforce: true,
        }),
      })
      const j = await res.json()
      flash(!!j.success, j.message ?? (j.success ? 'สร้างแผนสำเร็จ' : 'สร้างแผนไม่สำเร็จ'))
      if (j.success) load()
    } catch (e) {
      flash(false, e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
      setConfirmEmergency(false)
    }
  }

  const handleAdd = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/production-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          target_quantity: Number(form.target_quantity),
          sku_name: form.sku_name || null,
        }),
      })
      const j = await res.json()
      if (j.error) { flash(false, j.error); return }
      flash(true, 'เพิ่ม SKU สำเร็จ')
      setShowAdd(false)
      setForm({ ...EMPTY_FORM, production_date: date })
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin — แผนผลิต</h1>
        <p className="text-gray-500 mt-1">แก้ไขยอดผลิตราย SKU / ลบทั้ง Phase / เพิ่ม SKU</p>
      </div>

      {msg && (
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium border ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {msg.ok ? '✓' : '✗'} {msg.text}
        </div>
      )}

      {/* Toolbar */}
      <div className="card flex flex-wrap items-center gap-3">
        <Calendar size={18} className="text-blue-500 shrink-0" />
        <label className="text-sm font-medium text-gray-700">วันที่</label>
        <input type="date" value={date}
          onChange={e => { setDate(e.target.value); setForm(f => ({ ...f, production_date: e.target.value })) }}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

        <label className="text-sm font-medium text-gray-700 ml-2">Phase</label>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="">ทั้งหมด</option>
          {PERIODS.map(p => (
            <option key={p} value={p}>{p} ({PERIOD_PHASE[p]})</option>
          ))}
        </select>

        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 text-gray-600 border border-gray-300 bg-white hover:bg-gray-50 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />รีโหลด
        </button>

        {canEdit && (
        <button onClick={() => setConfirmEmergency(true)}
          className="ml-auto flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Zap size={16} />สร้างแผนฉุกเฉิน (Phase 1)
        </button>
        )}

        {canEdit && (
        <button onClick={() => { setForm({ ...EMPTY_FORM, production_date: date, period: period || 'เช้า' }); setShowAdd(true) }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} />เพิ่ม SKU
        </button>
        )}
      </div>

      {/* Delete phase buttons */}
      {canEdit && (
      <div className="flex flex-wrap gap-3">
        {PERIODS.map(p => (
          <button key={p} onClick={() => setConfirmBulk(p)}
            className="flex items-center gap-2 border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg text-sm font-medium">
            <Trash2 size={14} />ลบ {PERIOD_PHASE[p]} ทั้งหมด
          </button>
        ))}
      </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="card text-center py-12 text-gray-400">
          <RefreshCw size={28} className="animate-spin mx-auto mb-2" />
          <p>กำลังโหลด...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">ไม่พบรายการ</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Channel</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Station</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">SKU</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">ชื่อสินค้า</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">{formatThaiDate(histDates?.d3)}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">{formatThaiDate(histDates?.d2)}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">{formatThaiDate(histDates?.d1)}</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">ยอดผลิต (กก.)</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const k = rowKey(r)
                const isEditing = editKey === k
                return (
                  <tr key={k} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 font-medium">{r.channel ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATION_COLOR[r.table_name] ?? 'bg-gray-100 text-gray-700'}`}>
                        {r.table_name}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{r.sku}</td>
                    <td className="px-4 py-2.5 text-gray-800">{r.sku_name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 font-normal">
                      {r.qty_d3 > 0 ? Math.round(r.qty_d3).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 font-normal">
                      {r.qty_d2 > 0 ? Math.round(r.qty_d2).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 font-normal">
                      {r.qty_d1 > 0 ? Math.round(r.qty_d1).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(r); if (e.key === 'Escape') setEditKey(null) }}
                          autoFocus
                          className="w-28 border border-blue-400 rounded-lg px-2 py-1 text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <span className="font-semibold text-gray-900">
                          {Math.round(r.total_qty).toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!canEdit ? null : isEditing ? (
                        <div className="flex items-center gap-1 justify-center">
                          <button onClick={() => saveEdit(r)}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                            <Check size={15} />
                          </button>
                          <button onClick={() => setEditKey(null)}
                            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors">
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEdit(r)}
                          className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Pencil size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={7} className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                  รวม {rows.length} รายการ
                </td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">
                  {Math.round(rows.reduce((s, r) => s + r.total_qty, 0)).toLocaleString()}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
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
              ลบแผนผลิต <strong>{PERIOD_PHASE[confirmBulk]} ({confirmBulk})</strong> วันที่ {date} ทั้งหมด
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

      {/* Confirm emergency plan generation */}
      {confirmEmergency && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <Zap size={24} />
              <h2 className="text-lg font-bold">สร้างแผนฉุกเฉิน?</h2>
            </div>
            <p className="text-gray-600 text-sm">
              สร้างแผนผลิต <strong>Phase 1 (เช้า)</strong> วันที่ {date} ทันที
              โดยไม่ต้องรอ Sync ข้อมูลพนักงาน 8:05 — ถ้ายังไม่มีข้อมูลกำลังคนของวันนี้
              จะใช้ข้อมูลของวันก่อนหน้าล่าสุดแทน
              <br /><br />
              <span className="text-red-600 font-medium">คำเตือน:</span> จะเขียนทับแผน Phase 1 เดิมของวันนี้ทั้งหมด
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmEmergency(false)} disabled={generating}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                ยกเลิก
              </button>
              <button onClick={generateEmergencyPlan} disabled={generating}
                className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-50">
                {generating ? 'กำลังสร้าง...' : 'สร้างแผนฉุกเฉิน'}
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
                <input type="date" value={form.production_date}
                  onChange={e => setForm(f => ({ ...f, production_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Phase (รอบ)</label>
                <select value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {PERIODS.map(p => <option key={p} value={p}>{p} ({PERIOD_PHASE[p]})</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Station</label>
                <select value={form.table_name} onChange={e => setForm(f => ({ ...f, table_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {STATIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">SKU</label>
                <input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  placeholder="23086965"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Channel</label>
                <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 mb-1 block">ชื่อสินค้า (ไม่บังคับ)</label>
                <input value={form.sku_name} onChange={e => setForm(f => ({ ...f, sku_name: e.target.value }))}
                  placeholder="สะโพกแต่งตัดชิ้น SIS กก.ละ"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>

              <div className="col-span-2">
                <label className="text-xs font-medium text-gray-600 mb-1 block">ยอดผลิต (กก.)</label>
                <input type="number" min="0" value={form.target_quantity}
                  onChange={e => setForm(f => ({ ...f, target_quantity: e.target.value }))}
                  placeholder="500"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                ยกเลิก
              </button>
              <button onClick={handleAdd} disabled={saving || !form.sku || !form.target_quantity}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
