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
}

interface SupplementaryEntry {
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

const SLOT_CONFIGS = [
  {
    slot: 1,
    name: 'แผนเสริมรอบที่ 1',
    border: 'border-teal-500',
    bg: 'bg-teal-50/50',
    text: 'text-teal-900',
    button: 'bg-teal-600 hover:bg-teal-700 focus:ring-teal-500',
    badge: 'bg-teal-100 text-teal-800 border-teal-200',
    accentText: 'text-teal-600',
  },
  {
    slot: 2,
    name: 'แผนเสริมรอบที่ 2',
    border: 'border-orange-500',
    bg: 'bg-orange-50/50',
    text: 'text-orange-900',
    button: 'bg-orange-600 hover:bg-orange-700 focus:ring-orange-500',
    badge: 'bg-orange-100 text-orange-800 border-orange-200',
    accentText: 'text-orange-600',
  },
  {
    slot: 3,
    name: 'แผนเสริมรอบที่ 3',
    border: 'border-purple-500',
    bg: 'bg-purple-50/50',
    text: 'text-purple-900',
    button: 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500',
    badge: 'bg-purple-100 text-purple-800 border-purple-200',
    accentText: 'text-purple-600',
  },
]

export default function SupplementaryPlanPage() {
  const [activeSlot, setActiveSlot] = useState<number>(1)
  const [productMaster, setProductMaster] = useState<Record<string, string>>({})
  const [loadingTime, setLoadingTime] = useState('10:00')
  const [productionDate, setProductionDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loadingDate, setLoadingDate] = useState(() => new Date().toISOString().split('T')[0])
  const [channel, setChannel] = useState('LOTUS')
  const [items, setItems] = useState<SupplementaryEntry[]>([{ sku: '', skuName: '', qty: 0 }])

  const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState<UploadRecord[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  const activeCfg = SLOT_CONFIGS.find(c => c.slot === activeSlot) ?? SLOT_CONFIGS[0]
  const deadlineTime = loadingTime ? addMinutes(loadingTime, -30) : ''
  const apiBase = `/api/upload-supplementary-plan?slot=${activeSlot}`

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

  // Load history when slot changes
  const fetchHistory = async () => {
    try {
      const res = await fetch(apiBase)
      const data = await res.json()
      setHistory(data.uploads ?? [])
    } catch { /* silent */ }
  }

  useEffect(() => {
    fetchHistory()
  }, [activeSlot])

  // Handle item actions
  const handleAddItem = () => {
    setItems([...items, { sku: '', skuName: '', qty: 0 }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length === 1) {
      setItems([{ sku: '', skuName: '', qty: 0 }])
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
    }
    setItems(newItems)
  }

  // Handle Form Submission
  const handleSubmit = async () => {
    setStatus('idle')
    setMessage('')

    // Validations
    if (!loadingTime) {
      setStatus('error')
      setMessage('กรุณาระบุเวลาที่ต้องโหลด')
      return
    }
    const validItems = items.filter(it => it.sku.trim() !== '' && it.qty > 0)
    if (!validItems.length) {
      setStatus('error')
      setMessage('กรุณากรอกรหัสสินค้าและปริมาณมากกว่า 0 อย่างน้อย 1 รายการ')
      return
    }

    setStatus('uploading')

    try {
      // Format rows for backend upload API parser
      const rows = validItems.map(it => ({
        'รหัสสินค้า': it.sku,
        'ชื่อสินค้า': it.skuName,
        'ปริมาณ': it.qty,
        'วันที่สั่ง': productionDate,
        'วันที่ส่ง': loadingDate,
      }))

      // Create a unique, readable name for this manual entry
      const nowStr = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/:/g, '')
      const filename = `คีย์มือ - ${channel} - ${productionDate}_${nowStr}`

      const res = await fetch('/api/upload-supplementary-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          filename,
          loading_time: loadingTime,
          deadline_time: deadlineTime,
          slot: activeSlot,
        }),
      })

      const result = await res.json()
      if (result.success) {
        setStatus('success')
        setMessage(result.message)
        // Reset items list
        setItems([{ sku: '', skuName: '', qty: 0 }])
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
      const res = await fetch(`/api/upload-supplementary-plan?slot=${activeSlot}&file=${encodeURIComponent(sourceFile)}`, { method: 'DELETE' })
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
      const res  = await fetch(`/api/download-upload?table=production_plan_supplementary&file=${encodeURIComponent(sourceFile)}&slot=${activeSlot}`)
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
      XLSX.utils.book_append_sheet(wb, ws, `แผนเสริม ${activeSlot}`)
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
          <Layers className="text-blue-600" />
          แผนรอบเสริม
        </h1>
        <p className="text-gray-500 mt-1 text-sm sm:text-base">
          กรอกข้อมูลแผนผลิตที่แทรกเข้ามาแทนการอัพโหลดไฟล์ ระบุเวลาโหลดจ่ายและสินค้าเพื่อเตรียมจัดตารางกำลังคน
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-1 bg-white p-1 rounded-xl shadow-sm border">
        {SLOT_CONFIGS.map(cfg => {
          const isActive = cfg.slot === activeSlot
          return (
            <button
              key={cfg.slot}
              onClick={() => {
                setActiveSlot(cfg.slot)
                setStatus('idle')
                setMessage('')
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold rounded-lg transition-all ${
                isActive
                  ? `${cfg.bg} ${cfg.accentText} shadow-sm border border-current/10`
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-current animate-pulse' : 'bg-gray-300'}`} />
              {cfg.name}
            </button>
          )
        })}
      </div>

      {/* Main Form Container */}
      <div className={`border-t-4 ${activeCfg.border} bg-white rounded-xl shadow-sm p-6 space-y-6 border`}>
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className={`text-lg font-bold ${activeCfg.text}`}>{activeCfg.name} (กรอกข้อมูล)</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${activeCfg.badge}`}>
            Slot {activeSlot}
          </span>
        </div>

        {/* Form Metadata */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
          {/* วันที่ผลิต */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 flex items-center gap-1">
              <Calendar size={13} />
              วันที่ผลิต (วันที่สั่ง)
            </label>
            <input
              type="date"
              value={productionDate}
              onChange={e => setProductionDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* วันที่โหลด */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 flex items-center gap-1">
              <Calendar size={13} />
              วันที่โหลด (วันที่ส่ง)
            </label>
            <input
              type="date"
              value={loadingDate}
              onChange={e => setLoadingDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* เวลาต้องโหลด */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 flex items-center gap-1">
              <Truck size={13} />
              เวลาต้องโหลด
            </label>
            <div className="flex items-center gap-2">
              <select
                value={loadingTime ? loadingTime.split(':')[0] : ''}
                onChange={e => {
                  const mm = loadingTime ? loadingTime.split(':')[1] : '00'
                  setLoadingTime(`${e.target.value}:${mm}`)
                }}
                className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span className="text-gray-400 font-bold">:</span>
              <select
                value={loadingTime ? loadingTime.split(':')[1] : ''}
                onChange={e => {
                  const hh = loadingTime ? loadingTime.split(':')[0] : '10'
                  setLoadingTime(`${hh}:${e.target.value}`)
                }}
                className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {['00', '15', '30', '45'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span className="text-xs text-gray-400 font-medium">น.</span>
            </div>
            {deadlineTime && (
              <div className="text-[11px] text-red-600 font-semibold flex items-center gap-1 mt-1">
                <Clock size={11} />
                Deadline: {deadlineTime} น. (ก่อนโหลด 30 นาที)
              </div>
            )}
          </div>

          {/* ช่องทางขาย */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 flex items-center gap-1">
              <FileText size={13} />
              ช่องทางขาย
            </label>
            <select
              value={channel}
              onChange={e => setChannel(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="LOTUS">LOTUS</option>
              <option value="Makro">Makro</option>
              <option value="Wet Market">Wet Market</option>
              <option value="อื่นๆ">อื่นๆ</option>
            </select>
          </div>
        </div>

        {/* Dynamic Items Entry */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-800">รายการสินค้า (SKU List)</h3>
            <button
              onClick={handleAddItem}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors bg-blue-50 hover:bg-blue-100/80 px-2.5 py-1.5 rounded-lg border border-blue-200"
            >
              <Plus size={13} />
              เพิ่มรายการ
            </button>
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden shadow-inner">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-gray-100 border-b border-gray-200 text-gray-700 text-xs font-bold">
                  <th className="px-4 py-3 w-16 text-center">ลำดับ</th>
                  <th className="px-4 py-3 w-48">รหัสสินค้า (SAP)</th>
                  <th className="px-4 py-3">ชื่อสินค้า (Auto fill)</th>
                  <th className="px-4 py-3 w-36">ปริมาณ (กก.)</th>
                  <th className="px-4 py-3 w-16 text-center">ลบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/55 transition-colors">
                    <td className="px-4 py-3 text-center font-mono text-gray-500 text-xs">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={it.sku}
                        onChange={e => handleItemChange(idx, 'sku', e.target.value)}
                        placeholder="เช่น 23029401"
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={it.skuName}
                        onChange={e => handleItemChange(idx, 'skuName', e.target.value)}
                        placeholder="ชื่อสินค้าจะขึ้นอัตโนมัติ"
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.qty || ''}
                        onChange={e => handleItemChange(idx, 'qty', e.target.value)}
                        placeholder="0.0"
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
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
              <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-green-700 text-xs">
                <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
                {message}
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={status === 'uploading'}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-sm ${activeCfg.button} disabled:opacity-50 disabled:cursor-not-allowed`}
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
        <div className="bg-white rounded-xl shadow-sm p-6 border">
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            <FileSpreadsheet className="text-gray-500" size={16} />
            ประวัติการบันทึกข้อมูล (Slot {activeSlot})
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
                    {h.loading_time && (
                      <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Truck size={9} />โหลด {h.loading_time} น.
                      </span>
                    )}
                    {h.deadline_time && (
                      <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5 flex items-center gap-1">
                        <Clock size={9} />deadline {h.deadline_time} น.
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
