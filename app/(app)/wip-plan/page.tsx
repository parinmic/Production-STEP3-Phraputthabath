'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Calendar, Save, CheckCircle2, AlertCircle } from 'lucide-react'

interface WipRow {
  sap_code: string
  sku_name: string
  station: string
  stockKg: number
  orderKg: number
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
      // 1. Get WIP SKUs from master_logic_calculation
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

      const wipSapList = wipSkus.map(s => s.sap_code)

      // 2. Reverse BOM lookup: WIP SAP → final product SAPs
      const { data: bomData } = await supabase
        .from('bom_items')
        .select('raw_sap, product_sap')
        .in('raw_sap', wipSapList)

      // normalise final product SAP → strip leading zeros for consistent lookup
      const finalSapToWip = new Map<string, string>()
      for (const b of bomData ?? []) {
        const rawSap = String(b.raw_sap).trim()
        const productSap = String(b.product_sap ?? '').trim()
        if (!/^\d+$/.test(productSap)) continue
        const norm = productSap.replace(/^0+/, '')
        if (!finalSapToWip.has(norm)) finalSapToWip.set(norm, rawSap)
      }
      const allFinalSapNorms = Array.from(finalSapToWip.keys())

      // 3. Load weight_per_bag for final products
      const { data: pumData } = await supabase
        .from('picking_unit_master')
        .select('sap, weight_per_bag')
        .in('sap', allFinalSapNorms)

      const wpbMap = new Map<string, number>()
      for (const p of pumData ?? []) {
        const norm = String(p.sap).replace(/^0+/, '')
        wpbMap.set(norm, Number(p.weight_per_bag))
      }

      // 4. Load last 7 days using Phase 3 order logic (same as executive dashboard):
      //    plan100 → Makro 1400 + 0800 fallback → Lotus/WM 1400 (skip if plan100 covers SKU)
      const histDates: string[] = []
      for (let i = 1; i <= 7; i++) {
        const dt = new Date()
        dt.setDate(dt.getDate() - i)
        histDates.push(dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }))
      }

      const [
        { data: histPlan100 },
        { data: histMakro },
        { data: histLotus },
        { data: histWm },
      ] = await Promise.all([
        supabase.from('production_plan_100').select('plan_date, sap, weight_total').in('plan_date', histDates),
        supabase.from('makro_orders').select('delivery_date, sku, quantity, upload_round').in('delivery_date', histDates),
        supabase.from('lotus_orders').select('delivery_date, sku, quantity').in('delivery_date', histDates).eq('upload_round', '1400'),
        supabase.from('wet_market_orders').select('delivery_date, sku, quantity').in('delivery_date', histDates).eq('upload_round', '1400'),
      ])

      // 5. Per-day Phase 3 priority logic → accumulate WIP kg over 7 days then average
      const wipKgSum = new Map<string, number>()

      for (const hDate of histDates) {
        const p100 = (histPlan100 ?? []).filter((r: {plan_date: string}) => r.plan_date === hDate)
        const mAll = (histMakro ?? []).filter((r: {delivery_date: string}) => r.delivery_date === hDate)
        const lot  = (histLotus ?? []).filter((r: {delivery_date: string}) => r.delivery_date === hDate)
        const wm   = (histWm ?? []).filter((r: {delivery_date: string}) => r.delivery_date === hDate)

        const p100Skus = new Set<string>()
        for (const r of p100 as {sap: string; weight_total: number}[]) {
          const norm = String(r.sap ?? '').replace(/^0+/, '')
          p100Skus.add(norm)
          const wipSap = finalSapToWip.get(norm)
          if (wipSap) wipKgSum.set(wipSap, (wipKgSum.get(wipSap) ?? 0) + Number(r.weight_total ?? 0))
        }

        const m1400 = mAll.filter((r: {upload_round: string|number}) => String(r.upload_round) === '1400')
        const m0800 = mAll.filter((r: {upload_round: string|number}) => String(r.upload_round) === '0800')
        const m1400Skus = new Set((m1400 as {sku: string}[]).map(r => String(r.sku ?? '').replace(/^0+/, '')))
        for (const r of [...m1400, ...(m0800 as {sku: string}[]).filter(r => !m1400Skus.has(String(r.sku ?? '').replace(/^0+/, '')))] as {sku: string; quantity: number}[]) {
          const norm = String(r.sku ?? '').replace(/^0+/, '')
          const wipSap = finalSapToWip.get(norm)
          if (!wipSap) continue
          const wpb = wpbMap.get(norm) ?? 0
          wipKgSum.set(wipSap, (wipKgSum.get(wipSap) ?? 0) + Number(r.quantity ?? 0) * wpb)
        }

        for (const r of [...lot, ...wm] as {sku: string; quantity: number}[]) {
          const norm = String(r.sku ?? '').replace(/^0+/, '')
          if (p100Skus.has(norm)) continue
          const wipSap = finalSapToWip.get(norm)
          if (!wipSap) continue
          const wpb = wpbMap.get(norm) ?? 0
          wipKgSum.set(wipSap, (wipKgSum.get(wipSap) ?? 0) + Number(r.quantity ?? 0) * wpb)
        }
      }

      const orderKgByWip = new Map<string, number>()
      for (const [wipSap, total] of wipKgSum)
        orderKgByWip.set(wipSap, total / 7)

      // 6. Load WIP stock from stock_20 by material_name matching sku_name
      const wipNames = wipSkus.map(s => s.sku_name).filter(Boolean)
      const { data: stockData } = await supabase
        .from('stock_20')
        .select('material_name, weight_total')
        .in('material_name', wipNames)

      const stockKgByName = new Map<string, number>()
      for (const r of stockData ?? []) {
        const name = String(r.material_name ?? '').trim()
        stockKgByName.set(name, (stockKgByName.get(name) ?? 0) + Number(r.weight_total))
      }

      // 7. Load saved WIP plan quantities for selected date
      const { data: planData } = await supabase
        .from('wip_plan')
        .select('sap_code, quantity')
        .eq('plan_date', d)

      const qtyMap = new Map<string, number>()
      for (const p of planData ?? []) qtyMap.set(String(p.sap_code), Number(p.quantity))

      setRows(wipSkus.map(s => ({
        ...s,
        stockKg: stockKgByName.get(s.sku_name) ?? 0,
        orderKg: orderKgByWip.get(s.sap_code) ?? 0,
        quantity: qtyMap.get(s.sap_code) ?? 0,
      })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData(date) }, [date, loadData])

  const handleSave = async () => {
    setStatus('saving')
    setMessage('')
    try {
      const upserts = rows.map(r => {
        const avgKg = r.orderKg / 7
        const wipInitial = Math.floor(avgKg * 1.2 / 100) * 100
        const finalPlan = r.quantity > 0 ? r.quantity : wipInitial
        return {
          plan_date: date,
          sap_code: r.sap_code,
          quantity: finalPlan,
          updated_at: new Date().toISOString(),
        }
      })
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

  const fmt = (n: number) => n === 0 ? '—' : n.toLocaleString('th-TH', { maximumFractionDigits: 0 })

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
                <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-600 align-bottom">
                  <th className="px-4 py-3 w-8 text-center whitespace-nowrap">#</th>
                  <th className="px-4 py-3 w-28 whitespace-nowrap">SAP</th>
                  <th className="px-4 py-3 whitespace-nowrap">ชื่อสินค้า</th>
                  <th className="px-4 py-3 w-24 whitespace-nowrap">จุดงาน</th>
                  <th className="px-4 py-3 w-32 text-right text-gray-700 whitespace-nowrap">Stock ปัจจุบัน (กก.)</th>
                  <th className="px-4 py-3 w-36 text-right text-blue-700 whitespace-nowrap">Average 7 วัน (กก.)</th>
                  <th className="px-4 py-3 w-36 text-right text-indigo-700 whitespace-nowrap">ปริมาณ WIP ตั้งต้น (กก.)</th>
                  <th className="px-4 py-3 w-40 text-right whitespace-nowrap">จำนวนที่กรอก (กก.)</th>
                  <th className="px-4 py-3 w-32 text-right text-emerald-700 whitespace-nowrap">Final Plan (กก.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => {
                  const avgKg = row.orderKg / 7
                  const wipInitial = Math.floor(avgKg * 1.2 / 100) * 100
                  const finalPlan = row.quantity > 0 ? row.quantity : wipInitial
                  return (
                    <tr key={row.sap_code} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-center text-xs text-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{row.sap_code}</td>
                      <td className="px-4 py-3 text-sm text-gray-800">{row.sku_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{row.station}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">
                        {row.stockKg > 0 ? Math.round(row.stockKg).toLocaleString('th-TH') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-blue-700">
                        {avgKg > 0 ? Math.round(avgKg).toLocaleString('th-TH') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-indigo-700">
                        {wipInitial > 0 ? wipInitial.toLocaleString('th-TH') : '—'}
                      </td>
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
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-700">
                        {finalPlan > 0 ? finalPlan.toLocaleString('th-TH') : '—'}
                      </td>
                    </tr>
                  )
                })}
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
