'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, KeyRound, Trash2, Check, X, Eye, EyeOff, UserCheck, UserX, Upload, FileSpreadsheet } from 'lucide-react'
import * as XLSX from 'xlsx'

const MENU_LABELS: Record<string, string> = {
  all:              'ทุกเมนู',
  withdrawal:       'เบิกสินค้า',
  production:       'คำสั่งผลิต',
  saw_machine_plan: 'เครื่องเลื่อย',
  shortage:         'Raw รอผลิต',
}

interface UserRow {
  id: string
  username: string
  is_active: boolean
  position_id: string
  position_name: string
  menus: string[]
  created_at: string
}

interface Position {
  id: string
  name: string
  menus: string[]
}

interface PreviewRow { position: string; username: string; password: string; menu: string }

const EMPTY_ADD = { username: '', password: '', position_id: '' }

export default function AdminUsersPage() {
  const [users, setUsers]         = useState<UserRow[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  const [showAdd, setShowAdd]   = useState(false)
  const [addForm, setAddForm]   = useState({ ...EMPTY_ADD })
  const [showAddPw, setShowAddPw] = useState(false)
  const [addLoading, setAddLoading] = useState(false)

  const [changePwId, setChangePwId] = useState<string | null>(null)
  const [newPw, setNewPw]           = useState('')
  const [showNewPw, setShowNewPw]   = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Upload Excel
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview]       = useState<PreviewRow[] | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    setUsers(data.users ?? [])
    setPositions(data.positions ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 3500)
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddLoading(true)
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    const data = await res.json()
    if (data.success) {
      flash(true, 'เพิ่ม User สำเร็จ')
      setShowAdd(false)
      setAddForm({ ...EMPTY_ADD })
      load()
    } else {
      flash(false, data.message ?? 'เกิดข้อผิดพลาด')
    }
    setAddLoading(false)
  }

  async function handleToggleActive(u: UserRow) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, is_active: !u.is_active }),
    })
    const data = await res.json()
    if (data.success) {
      flash(true, u.is_active ? 'ปิดใช้งาน User แล้ว' : 'เปิดใช้งาน User แล้ว')
      load()
    } else {
      flash(false, data.message ?? 'เกิดข้อผิดพลาด')
    }
  }

  async function handleChangePw() {
    if (!changePwId || !newPw.trim()) return
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: changePwId, password: newPw }),
    })
    const data = await res.json()
    if (data.success) {
      flash(true, 'เปลี่ยนรหัสผ่านสำเร็จ')
      setChangePwId(null)
      setNewPw('')
    } else {
      flash(false, data.message ?? 'เกิดข้อผิดพลาด')
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deleteId }),
    })
    const data = await res.json()
    if (data.success) {
      flash(true, 'ลบ User สำเร็จ')
      setDeleteId(null)
      load()
    } else {
      flash(false, data.message ?? 'เกิดข้อผิดพลาด')
    }
  }

  const selectedPos = positions.find(p => p.id === addForm.position_id)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target!.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      // skip header row (row 0)
      const rows: PreviewRow[] = raw.slice(1)
        .filter(r => String(r[0] ?? '').trim())
        .map(r => ({
          position: String(r[0] ?? '').trim(),
          username: String(r[1] ?? '').trim(),
          password: String(r[2] ?? '').trim(),
          menu:     String(r[3] ?? '').trim(),
        }))
      setPreview(rows)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function handleUploadConfirm() {
    if (!preview?.length) return
    setUploadLoading(true)
    const res = await fetch('/api/admin/users/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: preview }),
    })
    const data = await res.json()
    if (data.success) {
      flash(true, `อัพโหลดสำเร็จ — สร้างใหม่ ${data.created} รายการ, อัปเดต ${data.updated} รายการ`)
      setPreview(null)
      load()
    } else {
      flash(false, data.message ?? 'เกิดข้อผิดพลาด')
    }
    setUploadLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User ระบบผลิต</h1>
          <p className="text-gray-500 mt-1 text-sm">จัดการผู้ใช้งานระบบพิเศษ (STEP 3)</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <FileSpreadsheet size={16} />
            อัพโหลด Excel
          </button>
          <button
            onClick={() => {
              setShowAdd(true)
              setAddForm({ ...EMPTY_ADD, position_id: positions[0]?.id ?? '' })
            }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            เพิ่ม User
          </button>
        </div>
      </div>

      {/* Flash */}
      {msg && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium border ${msg.ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Excel preview */}
      {preview && (
        <div className="border border-blue-200 rounded-xl overflow-hidden">
          <div className="bg-blue-50 px-4 py-3 flex items-center justify-between border-b border-blue-200">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Upload size={15} />
              พบข้อมูล {preview.length} แถว — ตรวจสอบก่อนยืนยัน
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleUploadConfirm}
                disabled={uploadLoading}
                className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                <Check size={14} />
                {uploadLoading ? 'กำลังบันทึก...' : 'ยืนยันอัพโหลด'}
              </button>
              <button onClick={() => setPreview(null)} className="p-1.5 text-blue-400 hover:text-blue-600">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">ตำแหน่ง</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Username</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Password</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Menu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-800">{r.position}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-700">{r.username || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">{r.password ? '••••' : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-1.5 text-gray-600">{r.menu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-4">
          <p className="font-semibold text-gray-800">เพิ่ม User ใหม่</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">ตำแหน่ง</label>
              <select
                value={addForm.position_id}
                onChange={e => setAddForm(f => ({ ...f, position_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              >
                <option value="">-- เลือกตำแหน่ง --</option>
                {positions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Username</label>
              <input
                type="text"
                value={addForm.username}
                onChange={e => setAddForm(f => ({ ...f, username: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="ชื่อผู้ใช้"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Password</label>
              <div className="relative">
                <input
                  type={showAddPw ? 'text' : 'password'}
                  value={addForm.password}
                  onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="รหัสผ่าน"
                  required
                />
                <button type="button" onClick={() => setShowAddPw(v => !v)} tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showAddPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>
          {selectedPos && (
            <p className="text-xs text-gray-500">
              เมนูที่เข้าถึงได้: <span className="text-gray-700 font-medium">
                {selectedPos.menus.map(k => MENU_LABELS[k] ?? k).join(', ') || '—'}
              </span>
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={addLoading}
              className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              <Check size={15} />
              {addLoading ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">
              <X size={15} />
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-gray-400 text-sm">กำลังโหลด...</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ตำแหน่ง</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">เมนู</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">ยังไม่มีผู้ใช้งาน</td>
                </tr>
              )}
              {users.map(u => (
                <tr key={u.id} className={u.is_active ? '' : 'opacity-50 bg-gray-50'}>
                  <td className="px-4 py-3 font-medium text-gray-800">{u.position_name}</td>
                  <td className="px-4 py-3 text-gray-700 font-mono">{u.username}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.menus.map(k => (
                        <span key={k} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                          {MENU_LABELS[k] ?? k}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 justify-end">

                      {/* Change password */}
                      {changePwId === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <div className="relative">
                            <input
                              type={showNewPw ? 'text' : 'password'}
                              value={newPw}
                              onChange={e => setNewPw(e.target.value)}
                              className="border border-gray-200 rounded-lg px-2 py-1 pr-7 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="รหัสผ่านใหม่"
                              autoFocus
                            />
                            <button type="button" onClick={() => setShowNewPw(v => !v)} tabIndex={-1}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400">
                              {showNewPw ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </div>
                          <button onClick={handleChangePw} className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                            <Check size={14} />
                          </button>
                          <button onClick={() => { setChangePwId(null); setNewPw('') }} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setChangePwId(u.id); setNewPw(''); setShowNewPw(false) }}
                          title="เปลี่ยนรหัสผ่าน"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <KeyRound size={15} />
                        </button>
                      )}

                      {/* Toggle active */}
                      <button
                        onClick={() => handleToggleActive(u)}
                        title={u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                        className={`p-1.5 rounded-lg transition-colors ${u.is_active ? 'text-gray-400 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                      >
                        {u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                      </button>

                      {/* Delete */}
                      {deleteId === u.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-red-500 whitespace-nowrap">ยืนยันลบ?</span>
                          <button onClick={handleDelete} className="p-1 text-red-600 hover:bg-red-50 rounded">
                            <Check size={14} />
                          </button>
                          <button onClick={() => setDeleteId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteId(u.id)}
                          title="ลบ User"
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
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
