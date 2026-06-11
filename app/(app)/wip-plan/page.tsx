'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Calendar, Save, CheckCircle2, AlertCircle } from 'lucide-react'

interface WipRow {
  sap_code: string
  sku_name: string
  station: string
  quantity: number
}

export default function WipPlanPage() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
  const [rows, setRows] = useState<WipRow[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const loadData = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const { data: masterData } = await supabase
        .from('master_logic_calculation')
        .select('row_data')
        .eq('calculation_type', 'Mas Productivity')
        .order('uploaded_at', { ascending: false })

      const seen = new Set<string>()
      const wipSkus: { sap_code: string; sku_name: string; station: string }[] = []
      for (const r of masterData ?? []) {
        const row = r.row_data as Record<string, unknown>
        if (String(row['กลุ่มสินค้า'] ?? '') !== 'กลุ่ม WIP') continue
        const sap = String(row['SAP'] ?? '').trim()
        if (!sap || seen.has(sap)) continue
        seen.add(sap)
        wipSkus.push({
          sap_code: sap,
          sku_name: String(row['ชื่อสินค้า'] ?? '').trim(),
          station: String(row['จุดงาน'] ?? '').trim(),
        })
      }

      const { data: planData } = await supabase
        .from('wip_plan')
        .select('sap_code, quantity')
        .eq('plan_date', d)

      const qtyMap = new Map<string, number>()
      for (const p of planData ?? []) qtyMap.set(String(p.sap_code), Number(p.quantity))

      setRows(wipSkus.map(s => ({ ...s, quantity: qtyMap.get(s.sap_code) ?? 0 })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData(date) }, [date, loadData])

  const handleSave = async () => {
    setStatus('saving')
    setMessage('')
    try {
      const upserts = rows.map(r => ({
        plan_date: date,
        sap_code: r.sap_code,
        quantity: r.quantity,
        updated_at: new Date().toISOString(),
      }))
      const { error } = await supabase
        .from('wip_plan')
        .upsert(upserts, { onConflict: 'plan_date,sap_code' })
      if (error) throw error
      setStatus('success')
      setMessage('บันทึกสำเร็จ')
    } catch (e: unknown) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">แผนผลิต WIP</h1>
        <p className="text-gray-500 mt-1 text-sm">กรอกจำนวน (กก.) ที่ต้องการผลิตสำหรับสินค้ากลุ่ม WIP</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
        <div className="max-w-xs space-y-1.5">
          <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
            <Calendar size={14} className="text-violet-600" />
            วันที่ผลิต
          </label>
          <input
            type="date"
            value={date}
            onChange={e => { setDate(e.target.value); setStatus('idle') }}
            className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all shadow-sm"
          />
        </div>
      </div>

      <div className="border-t-4 border-violet-600 bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">รายการสินค้ากลุ่ม WIP</h2>
          <span className="text-xs text-gray-400">{rows.length} รายการ</span>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">กำลังโหลด...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-600">
                  <th className="px-4 py-3 w-12 text-center">#</th>
                  <th className="px-4 py-3 w-32">SAP</th>
                  <th className="px-4 py-3">ชื่อสินค้า</th>
                  <th className="px-4 py-3 w-32">จุดงาน</th>
                  <th className="px-4 py-3 w-44 text-right">จำนวน (กก.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => (
                  <tr key={row.sap_code} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-center text-xs text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{row.sap_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-800">{row.sku_name}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{row.station}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.quantity || ''}
                        onChange={e => {
                          const newRows = [...rows]
                          newRows[i] = { ...row, quantity: Math.max(0, Number(e.target.value) || 0) }
                          setRows(newRows)
                          setStatus('idle')
                        }}
                        placeholder="0"
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-5 border-t border-gray-100 flex items-center justify-between gap-4">
          <div>
            {status === 'error' && (
              <div className="flex items-center gap-2 text-red-600 text-xs">
                <AlertCircle size={14} />
                {message}
              </div>
            )}
            {status === 'success' && (
              <div className="flex items-center gap-2 text-emerald-600 text-xs">
                <CheckCircle2 size={14} />
                {message}
              </div>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={status === 'saving' || loading}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'saving' ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <Save size={15} />
                บันทึก
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
