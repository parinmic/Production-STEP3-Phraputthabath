'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, KeyRound, Trash2, Check, X, Eye, EyeOff, UserCheck, UserX, Upload, FileSpreadsheet, Download } from 'lucide-react'
import * as XLSX from 'xlsx'
import { STATION_LABEL_TO_SLUG } from '@/lib/station-access'
import { SPECIAL_MENU_LABELS } from '@/lib/special-menu'
import { useCanEdit } from '@/lib/session-context'

// รูปแบบเก่า (ก่อนเปลี่ยนไฟล์ "User ระบบผลิต.xlsx" เป็นตัวเลข) — เก็บไว้แสดงผลย้อนหลังเผื่อมีข้อมูลเก่าค้าง
const MENU_LABELS: Record<string, string> = {
  all:              'ทุกเมนู',
  withdrawal:       'เบิกสินค้า',
  production:       'คำสั่งผลิต',
  saw_machine_plan: 'เครื่องเลื่อย',
  shortage:         'Raw รอผลิต',
}

const SLUG_TO_STATION_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STATION_LABEL_TO_SLUG).map(([label, slug]) => [slug, label])
)

function menuLabel(key: string): string {
  if (key === 'all') return 'ทุกเมนู'
  if (key in SPECIAL_MENU_LABELS) return `[${key}] ${SPECIAL_MENU_LABELS[key]}`
  if (key.startsWith('station:')) {
    const slug = key.slice('station:'.length)
    return `เฉพาะ Station ${SLUG_TO_STATION_LABEL[slug] ?? slug}`
  }
  return MENU_LABELS[key] ?? key
}

const STEP_LABELS: Record<string, { label: string; cls: string }> = {
  all: { label: 'ทั้งคู่',  cls: 'bg-violet-50 text-violet-700' },
  '2': { label: 'เบสิค',   cls: 'bg-sky-50 text-sky-700' },
  '3': { label: 'พิเศษ',   cls: 'bg-blue-50 text-blue-700' },
}

interface MenuGrant { key: string; access: 'edit' | 'view' }

interface UserRow {
  id: string
  username: string
  is_active: boolean
  position_id: string
  position_name: string
  menus: MenuGrant[]
  step: string
  created_at: string
}

interface Position {
  id: string
  name: string
  menus: string[]
  step: string
}

interface PreviewRow { position: string; username: string; password: string; step: string; menu: string; access: 'edit' | 'view' }

const ACCESS_LABEL: Record<'edit' | 'view', { label: string; cls: string }> = {
  edit: { label: 'Edit', cls: 'bg-blue-50 text-blue-700' },
  view: { label: 'View', cls: 'bg-gray-100 text-gray-600' },
}

const EMPTY_ADD = { username: '', password: '', position_id: '' }

export default function AdminUsersPage() {
  const canEdit = useCanEdit('12')
  const [users, setUsers]         = useState<UserRow[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading]     = useState(true)
  const [msg, setMsg]             = useState<{ ok: boolean; text: string } | null>(null)

  const [showAdd, setShowAdd]     = useState(false)
  const [addForm, setAddForm]     = useState({ ...EMPTY_ADD })
  const [showAddPw, setShowAddPw] = useState(false)
  const [addLoading, setAddLoading] = useState(false)

  const [changePwId, setChangePwId] = useState<string | null>(null)
  const [newPw, setNewPw]           = useState('')
  const [showNewPw, setShowNewPw]   = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview]           = useState<PreviewRow[] | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/admin/users')
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
    const res  = await fetch('/api/admin/users', {
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
    const res  = await fetch('/api/admin/users', {
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
    const res  = await fetch('/api/admin/users', {
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
    const res  = await fetch('/api/admin/users', {
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb  = XLSX.read(ev.target!.result, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      // columns: ตำแหน่ง(0), User(1), Password(2), Step(3), Edit(4), View(5)
      // แต่ละแถว = สิทธิ์ 1 เมนู — กรอกเลขเมนูในช่อง Edit (แก้ไขได้) หรือ View (ดูอย่างเดียว) ช่องใดช่องหนึ่ง
      const rows: PreviewRow[] = raw.slice(1)
        .filter(r => String(r[0] ?? '').trim())
        .map(r => {
          const editVal = String(r[4] ?? '').trim()
          const viewVal = String(r[5] ?? '').trim()
          return {
            position: String(r[0] ?? '').trim(),
            username: String(r[1] ?? '').trim(),
            password: String(r[2] ?? '').trim(),
            step:     String(r[3] ?? '').trim(),
            menu:     editVal || viewVal,
            access:   (editVal ? 'edit' : 'view') as 'edit' | 'view',
          }
        })
      setPreview(rows)
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  async function handleUploadConfirm() {
    if (!preview?.length) return
    setUploadLoading(true)
    const res  = await fetch('/api/admin/users/upload', {
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

  // Export ตำแหน่ง/เมนู/User ปัจจุบันเป็น Excel รูปแบบเดียวกับที่ "อัพโหลด Excel" อ่านได้
  // (ชีท Main + Detail ตรงกับไฟล์ต้นแบบ "User ระบบผลิต.xlsx") — ช่อง Password เว้นว่างเสมอ
  // เพราะระบบเก็บเฉพาะ hash ไม่มีรหัสผ่านจริงให้ export; อัพโหลดไฟล์นี้กลับเข้าไปโดยไม่กรอก
  // Password จะไม่ไปเขียนทับรหัสผ่านเดิมของ user ที่มีอยู่แล้ว (ดู fn_admin_bulk_upload_users)
  function handleExport() {
    const posInfo = new Map<string, { name: string; step: string; menus: MenuGrant[] }>()

    for (const u of users) {
      if (!posInfo.has(u.position_id)) {
        posInfo.set(u.position_id, { name: u.position_name, step: u.step, menus: u.menus })
      }
    }
    // ตำแหน่งที่ยังไม่มี user เลย — ใช้รายการเมนูจาก positions (ไม่มีแยก edit/view ให้ถือเป็น edit)
    for (const p of positions) {
      if (!posInfo.has(p.id)) {
        posInfo.set(p.id, { name: p.name, step: p.step, menus: p.menus.map(key => ({ key, access: 'edit' as const })) })
      }
    }

    const mainRows: (string | number)[][] = [['ตำแหน่ง', 'User', 'Password', 'Step', 'Edit', 'View']]
    for (const { name, step, menus } of Array.from(posInfo.values())) {
      for (const m of menus) {
        mainRows.push([name, '', '', step, m.access === 'edit' ? m.key : '', m.access === 'view' ? m.key : ''])
      }
    }
    for (const u of users) {
      mainRows.push([u.position_name, u.username, '', u.step, '', ''])
    }

    const detailRows: (string | number)[][] = [['หมายเลข', 'เมนู'], ...Object.entries(SPECIAL_MENU_LABELS)]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mainRows), 'Main')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), 'Detail')
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    XLSX.writeFile(wb, `User ระบบผลิต ${today}.xlsx`)
  }

  const selectedPos = positions.find(p => p.id === addForm.position_id)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User ระบบผลิต</h1>
          <p className="text-gray-500 mt-1 text-sm">จัดการผู้ใช้งานระบบผลิต (STEP 2 + STEP 3)</p>
        </div>
        {canEdit && (
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <button
            onClick={handleExport}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            <Download size={16} />
            ดาวน์โหลด Excel
          </button>
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
        )}
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
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Step</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Menu</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">สิทธิ์</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((r, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-800">{r.position}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-700">{r.username || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-1.5 font-mono text-gray-400">{r.password ? '••••' : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-1.5 text-gray-600">{r.step || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-600">{r.menu}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${ACCESS_LABEL[r.access].cls}`}>
                        {ACCESS_LABEL[r.access].label}
                      </span>
                    </td>
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
              เมนู: <span className="text-gray-700 font-medium">
                {selectedPos.menus.map(menuLabel).join(', ') || '—'}
              </span>
              {' · '}
              Step: <span className="text-gray-700 font-medium">{STEP_LABELS[selectedPos.step]?.label ?? selectedPos.step}</span>
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Step</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">เมนู</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">ยังไม่มีผู้ใช้งาน</td>
                </tr>
              )}
              {users.map(u => {
                const stepInfo = STEP_LABELS[u.step] ?? { label: u.step, cls: 'bg-gray-100 text-gray-500' }
                return (
                  <tr key={u.id} className={u.is_active ? '' : 'opacity-50 bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-800">{u.position_name}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono">{u.username}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${stepInfo.cls}`}>
                        {stepInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.menus.map(m => (
                          <span key={m.key}
                            className={`px-2 py-0.5 rounded text-xs ${m.access === 'view' ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700'}`}
                            title={m.access === 'view' ? 'ดูอย่างเดียว' : 'แก้ไขได้'}
                          >
                            {menuLabel(m.key)}{m.access === 'view' ? ' (View)' : ''}
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
                      {!canEdit ? null : (
                      <div className="flex items-center gap-1.5 justify-end">

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

                        <button
                          onClick={() => handleToggleActive(u)}
                          title={u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          className={`p-1.5 rounded-lg transition-colors ${u.is_active ? 'text-gray-400 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-400 hover:text-green-600 hover:bg-green-50'}`}
                        >
                          {u.is_active ? <UserX size={15} /> : <UserCheck size={15} />}
                        </button>

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
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
