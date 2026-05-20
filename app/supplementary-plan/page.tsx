'use client'
import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle2, X, Truck, Clock, Download, Plus, Trash2, Calendar, FileSpreadsheet, Save, Layers, FileText } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'

interface UploadRecord {
  source_file: string
  record_count: number
  uploaded_at: string
  loading_time?: string | null
  deadline_time?: string | null
  delivery_date?: string | null
  slots?: string[]
}

interface SupplementaryEntry {
  deliveryDate: string
  loadingTime: string
  channel: string
  sku: string
  skuName: string
  qty: number
}

function addMinutes(time: string, delta: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + delta
  const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60)
  const mm = ((total % 1440) + 1440) % 1440 % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export default function SupplementaryPlanPage() {
  const [productMaster, setProductMaster] = useState<Record<string, string>>({})
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().split('T')[0])
  const [items, setItems] = useState<SupplementaryEntry[]>([
    {
      deliveryDate: new Date().toISOString().split('T')[0],
      loadingTime: '10:00',
      channel: 'LOTUS',
      sku: '',
      skuName: '',
      qty: 0,
    },
  ])

  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<UploadRecord[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  // Fetch product master for auto-completion
  useEffect(() => {
    async function loadMaster() {
      try {
        const { data } = await supabase
          .from('master_logic_calculation')
          .select('row_data')
          .eq('calculation_type', 'Mas Productivity')
          .order('uploaded_at', { ascending: false })
        if (data) {
          const map: Record<string, string> = {}
          for (const row of data) {
            const r = row.row_data as Record<string, unknown>
            const sap = String(r['SAP'] ?? '').trim()
            const name = String(r['ชื่อสินค้า'] ?? '').trim()
            if (sap && name) {
              map[sap] = name
              map[sap.replace(/^0+/, '')] = name
            }
          }
          setProductMaster(map)
        }
      } catch (e) {
        console.error('Failed to load product master:', e)
      }
    }
    loadMaster()
  }, [])

  // Load consolidated upload history
  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/upload-supplementary-plan')
      const data = await res.json()
      setHistory(data.uploads ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  // Handle item actions
  const handleAddItem = () => {
    const lastItem = items[items.length - 1]
    setItems([
      ...items,
      {
        deliveryDate: lastItem ? lastItem.deliveryDate : new Date().toISOString().split('T')[0],
        loadingTime: lastItem ? lastItem.loadingTime : '10:00',
        channel: lastItem ? lastItem.channel : 'LOTUS',
        sku: '',
        skuName: '',
        qty: 0,
      },
    ])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length === 1) {
      setItems([
        {
          deliveryDate: new Date().toISOString().split('T')[0],
          loadingTime: '10:00',
          channel: 'LOTUS',
          sku: '',
          skuName: '',
          qty: 0,
        },
      ])
      return
    }
    setItems(items.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof SupplementaryEntry, val: string | number) => {
    const newItems = [...items]
    if (field === 'sku') {
      const skuVal = String(val).trim()
      newItems[index].sku = skuVal
      // Auto fill product name from master
      const cleanSku = skuVal.replace(/^0+/, '')
      if (productMaster[skuVal]) {
        newItems[index].skuName = productMaster[skuVal]
      } else if (productMaster[cleanSku]) {
        newItems[index].skuName = productMaster[cleanSku]
      }
    } else if (field === 'skuName') {
      newItems[index].skuName = String(val)
    } else if (field === 'qty') {
      newItems[index].qty = Math.max(0, Number(val) || 0)
    } else if (field === 'deliveryDate') {
      newItems[index].deliveryDate = String(val)
    } else if (field === 'loadingTime') {
      newItems[index].loadingTime = String(val)
    } else if (field === 'channel') {
      newItems[index].channel = String(val)
    }
    setItems(newItems)
  }

  // Handle Form Submission
  const handleSubmit = async () => {
    setStatus('idle')
    setMessage('')

    const validItems = items.filter(it => it.sku.trim() !== '' && it.qty > 0)
    if (!validItems.length) {
      setStatus('error')
      setMessage('กรุณากรอกรหัสสินค้าและปริมาณมากกว่า 0 อย่างน้อย 1 รายการ')
      return
    }

    // Check that all valid items have loadingTime set
    const missingTime = validItems.some(it => !it.loadingTime)
    if (missingTime) {
      setStatus('error')
      setMessage('กรุณาระบุเวลาที่ต้องโหลดให้ครบถ้วนทุกรายการ')
      return
    }

    setStatus('uploading')

    try {
      // Format rows for backend upload API parser
      const rows = validItems.map(it => {
        const deadTime = addMinutes(it.loadingTime, -30)
        return {
          'รหัสสินค้า': it.sku,
          'ชื่อสินค้า': it.skuName,
          'ปริมาณ': it.qty,
          'วันที่สั่ง': productionDate,
          'วันที่ส่ง': it.deliveryDate,
          loading_time: it.loadingTime,
          deadline_time: deadTime,
          channel: it.channel,
        }
      })

      // Get first channel or fallback
      const primaryChannel = validItems[0]?.channel ?? 'LOTUS'

      // Create a unique, readable name for this manual entry
      const nowStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '')
      const filename = `คีย์มือ - ${primaryChannel} - ${productionDate}_${nowStr}`

      const res = await fetch('/api/upload-supplementary-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          filename,
        }),
      })

      const result = await res.json()
      if (result.success) {
        setStatus('success')
        setMessage('บันทึกแผนรอบเสริมเรียบร้อยแล้ว')
        // Reset items list
        setItems([
          {
            deliveryDate: new Date().toISOString().split('T')[0],
            loadingTime: '10:00',
            channel: 'LOTUS',
            sku: '',
            skuName: '',
            qty: 0,
          },
        ])
        fetchHistory()
      } else {
        setStatus('error')
        setMessage(result.message ?? 'เกิดข้อผิดพลาดในการบันทึก')
      }
    } catch (e: unknown) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด')
    }
  }

  // Handle download and delete
  const handleDelete = async (sourceFile: string) => {
    if (!confirm(`ลบแผน "${sourceFile}" ออกจากระบบ?`)) return
    setDeleting(sourceFile)
    try {
      const res = await fetch(`/api/upload-supplementary-plan?file=${encodeURIComponent(sourceFile)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) fetchHistory()
      else alert(data.message ?? 'ลบไม่สำเร็จ')
    } catch {
      alert('เกิดข้อผิดพลาด')
    } finally {
      setDeleting(null)
    }
  }

  const handleDownload = async (sourceFile: string) => {
    try {
      const res  = await fetch(`/api/download-upload?table=production_plan_supplementary&file=${encodeURIComponent(sourceFile)}`)
      const json = await res.json()
      if (!json.data?.length) {
        alert('ไม่มีข้อมูล')
        return
      }
      const headers: Record<string, string> = json.headers
      const keys = Object.keys(headers)
      const ws = XLSX.utils.aoa_to_sheet([
        keys.map(k => headers[k]),
        ...(json.data as Record<string, unknown>[]).map(row => keys.map(k => row[k] ?? '')),
      ])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, `แผนรอบเสริม`)
      XLSX.writeFile(wb, `${sourceFile.replace(/\.[^.]+$/, '')}_export.xlsx`)
    } catch {
      alert('ดาวน์โหลดไม่สำเร็จ')
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Layers className="text-emerald-600" />
          แผนรอบเสริม
        </h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          กรอกข้อมูลแผนผลิตที่แทรกเข้ามา ระบุเวลาโหลดจ่ายและสินค้าเพื่อเตรียมจัดตารางกำลังคน
        </p>
      </div>

      {/* Production Date Selector Card */}
      <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-200">
        <div className="max-w-xs space-y-1.5">
          <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
            <Calendar size={14} className="text-emerald-600" />
            วันที่ผลิต (วันที่สั่ง)
          </label>
          <input
            type="date"
            value={productionDate}
            onChange={e => setProductionDate(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Main Grid Entry Form */}
      <div className="border-t-4 border-emerald-600 bg-white rounded-xl shadow-sm p-6 space-y-6 border">
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="text-lg font-bold text-gray-800">รายการแผนรอบเสริม</h2>
        </div>

        {/* Dynamic Items Entry */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">รายการสินค้า (SKU List)</h3>
            <button
              onClick={handleAddItem}
              className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-950 transition-colors bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-xl border border-emerald-200"
            >
              <Plus size={14} />
              เพิ่มรายการ
            </button>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-x-auto shadow-inner">
            <table className="w-full text-left border-collapse text-sm min-w-[900px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-700 text-xs font-bold">
                  <th className="px-4 py-3.5 w-16 text-center">ลำดับ</th>
                  <th className="px-4 py-3.5 w-48">วันที่โหลด (วันที่ส่ง)</th>
                  <th className="px-4 py-3.5 w-40">เวลาต้องโหลด</th>
                  <th className="px-4 py-3.5 w-40">ช่องทางขาย</th>
                  <th className="px-4 py-3.5 w-44">รหัสสินค้า (SAP)</th>
                  <th className="px-4 py-3.5">ชื่อสินค้า (Auto fill)</th>
                  <th className="px-4 py-3.5 w-36">ปริมาณ (กก.)</th>
                  <th className="px-4 py-3.5 w-16 text-center">ลบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/55 transition-colors">
                    <td className="px-4 py-3.5 text-center font-mono text-gray-500 text-xs">
                      {idx + 1}
                    </td>
                    {/* วันที่โหลด */}
                    <td className="px-4 py-3.5">
                      <input
                        type="date"
                        value={it.deliveryDate}
                        onChange={e => handleItemChange(idx, 'deliveryDate', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </td>
                    {/* เวลาต้องโหลด */}
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col gap-1">
                        <input
                          type="time"
                          value={it.loadingTime}
                          onChange={e => handleItemChange(idx, 'loadingTime', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        {it.loadingTime && (
                          <span className="text-[10px] text-red-500 font-semibold">
                            Deadline: {addMinutes(it.loadingTime, -30)} น.
                          </span>
                        )}
                      </div>
                    </td>
                    {/* ช่องทางขาย */}
                    <td className="px-4 py-3.5">
                      <select
                        value={it.channel}
                        onChange={e => handleItemChange(idx, 'channel', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="LOTUS">LOTUS</option>
                        <option value="Makro">Makro</option>
                        <option value="Wet Market">Wet Market</option>
                        <option value="อื่นๆ">อื่นๆ</option>
                      </select>
                    </td>
                    {/* รหัส SAP */}
                    <td className="px-4 py-3.5">
                      <input
                        type="text"
                        value={it.sku}
                        onChange={e => handleItemChange(idx, 'sku', e.target.value)}
                        placeholder="เช่น 23029401"
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </td>
                    {/* ชื่อสินค้า */}
                    <td className="px-4 py-3.5">
                      <input
                        type="text"
                        value={it.skuName}
                        onChange={e => handleItemChange(idx, 'skuName', e.target.value)}
                        placeholder="ชื่อสินค้าจะขึ้นอัตโนมัติ"
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </td>
                    {/* ปริมาณ */}
                    <td className="px-4 py-3.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.qty || ''}
                        onChange={e => handleItemChange(idx, 'qty', e.target.value)}
                        placeholder="0.0"
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 text-right"
                      />
                    </td>
                    {/* ลบ */}
                    <td className="px-4 py-3.5 text-center">
                      <button
                        onClick={() => handleRemoveItem(idx)}
                        className="text-gray-400 hover:text-red-600 transition-colors p-1"
                        title="ลบแถว"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Button & Status */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t">
          <div className="w-full sm:w-auto">
            {status === 'error' && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-red-700 text-xs">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                {message}
              </div>
            )}
            {status === 'success' && (
              <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-emerald-700 text-xs">
                <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                {message}
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={status === 'uploading'}
            className="w-full sm:w-auto flex items-center justify-center gap-2 text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-sm bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'uploading' ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              <>
                <Save size={16} />
                บันทึกแผนรอบเสริม
              </>
            )}
          </button>
        </div>
      </div>

      {/* Upload History */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <FileSpreadsheet className="text-gray-500" size={16} />
            ประวัติการบันทึกข้อมูลแผนรอบเสริม
          </h3>
          <div className="divide-y divide-gray-100">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-4 py-3 hover:bg-gray-50/50 -mx-3 px-3 rounded-lg transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-700 truncate font-semibold">{h.source_file}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-[11px] text-gray-400">
                      {h.record_count.toLocaleString()} รายการ · {new Date(h.uploaded_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    {h.delivery_date && (
                      <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Calendar size={9} />ส่ง {h.delivery_date}
                      </span>
                    )}
                    {h.loading_time && (
                      <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Truck size={9} />โหลด {h.loading_time} น.
                      </span>
                    )}
                    {h.slots && h.slots.length > 0 && (
                      <span className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200 rounded px-1.5 py-0.5">
                        Slot: {h.slots.sort().join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDownload(h.source_file)}
                    className="text-gray-300 hover:text-blue-500 transition-colors p-2 rounded-lg hover:bg-gray-100"
                    title="ดาวน์โหลด Excel"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(h.source_file)}
                    disabled={deleting === h.source_file}
                    className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40 p-2 rounded-lg hover:bg-gray-100"
                    title="ลบ"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
