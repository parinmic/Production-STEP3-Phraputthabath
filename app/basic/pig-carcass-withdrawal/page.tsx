'use client'
import { useState, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { Upload, Package } from 'lucide-react'

interface LotRow {
  lot: string
  qty: number
  wgt: number
  avg: number
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export default function PigCarcassWithdrawalPage() {
  const [rows, setRows]       = useState<LotRow[]>([])
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)

  function parseFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const wb   = XLSX.read(e.target?.result, { type: 'array' })
      const ws   = wb.Sheets[wb.SheetNames[0]]
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
      const parsed: LotRow[] = json.map(r => ({
        lot: String(r['LOT'] ?? ''),
        qty: Number(r['Qty'])       || 0,
        wgt: Number(r['Wgt'])       || 0,
        avg: Number(r['Wqt/Qty'])   || 0,
      }))
      parsed.sort((a, b) => a.lot.slice(-1).localeCompare(b.lot.slice(-1)))
      setRows(parsed)
      setFileName(file.name)
    }
    reader.readAsArrayBuffer(file)
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
    e.target.value = ''
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) parseFile(file)
  }, [])

  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const totalWgt = rows.reduce((s, r) => s + r.wgt, 0)
  const totalAvg = totalQty > 0 ? totalWgt / totalQty : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">เบิกหมูซีก</h1>
        <p className="text-gray-500 mt-1">อัพโหลดไฟล์ Input_Lot_หมูซากRM เพื่อดูข้อมูลล็อต</p>
      </div>

      {/* Upload zone */}
      <label
        htmlFor="file-upload"
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-colors ${
          dragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
        }`}
      >
        <Upload size={32} className="text-blue-400" />
        <div className="text-center">
          <p className="font-semibold text-gray-700">คลิกหรือลากไฟล์มาวาง</p>
          <p className="text-sm text-gray-400 mt-0.5">รองรับไฟล์ .xlsx — Input_Lot_หมูซากRM</p>
        </div>
        {fileName && (
          <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">
            {fileName}
          </span>
        )}
        <input id="file-upload" type="file" accept=".xlsx,.xls" className="hidden" onChange={onFile} />
      </label>

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <Package size={36} className="mx-auto mb-3 opacity-30" />
          <p>ยังไม่มีข้อมูล — อัพโหลดไฟล์เพื่อเริ่มต้น</p>
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm bg-white">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-400 w-8">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">เลขล็อต</th>
                  <th className="px-4 py-3 text-right font-semibold text-blue-700">
                    <div>จำนวนตัว</div>
                    <div className="font-normal text-blue-400">(ตัว)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-emerald-700">
                    <div>น้ำหนักรวม</div>
                    <div className="font-normal text-emerald-400">(กก.)</div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-orange-700">
                    <div>น้ำหนักเฉลี่ย</div>
                    <div className="font-normal text-orange-400">(กก./ตัว)</div>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={r.lot} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{r.lot}</td>
                    <td className="px-4 py-2.5 text-right text-blue-700 font-semibold">
                      {r.qty.toLocaleString('th-TH')}
                    </td>
                    <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(r.wgt)}</td>
                    <td className="px-4 py-2.5 text-right text-orange-700">{fmt(r.avg)}</td>
                  </tr>
                ))}
              </tbody>

              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr className="font-bold text-sm">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-gray-700">รวมทั้งหมด ({rows.length} ล็อต)</td>
                  <td className="px-4 py-3 text-right text-blue-700">
                    {totalQty.toLocaleString('th-TH')}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-700">{fmt(totalWgt)}</td>
                  <td className="px-4 py-3 text-right text-orange-700">{fmt(totalAvg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
