'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'

interface SessionUser { step: string; menus: string[]; username: string; position: string }

export default function LandingPage() {
  const router = useRouter()
  const [view, setView]           = useState<'login' | 'select'>('login')
  const [sessionUser, setSession] = useState<SessionUser | null>(null)

  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error,        setError]        = useState('')
  const [loading,      setLoading]      = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (data.success) {
      setSession(data.user)
      setView('select')
    } else {
      setError(data.message ?? 'เข้าสู่ระบบไม่สำเร็จ')
    }
    setLoading(false)
  }

  async function handleAdminBypass() {
    const res  = await fetch('/api/auth/admin-bypass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json()
    if (data.success) {
      setSession(data.user)
      setView('select')
    }
  }

  /* ── Login view ─────────────────────────────────────────── */
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-5">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col gap-6 relative">

          {/* Admin bypass */}
          <button
            onClick={handleAdminBypass}
            className="absolute top-4 right-4 flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors"
            title="Admin bypass"
          >
            <ShieldCheck size={13} />
            Admin
          </button>

          {/* Header */}
          <div className="text-center">
            <img src="/icon-transparent.png" alt="" className="w-10 h-10 mx-auto mb-3" />
            <p className="text-lg font-bold text-gray-900">ระบบวางแผนผลิต</p>
            <p className="text-sm text-gray-400 font-medium mt-0.5">โรงชำแหละสุกรพระพุทธบาท</p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">ชื่อผู้ใช้</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Username"
                autoComplete="username"
                autoFocus
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-gray-700">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                />
                <button type="button" onClick={() => setShowPassword(v => !v)} tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-center">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading}
              className="flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60">
              <LogIn size={16} />
              {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  /* ── Step selection view ─────────────────────────────────── */
  const canStep2 = sessionUser?.step === 'all' || sessionUser?.step === '2'
  const canStep3 = sessionUser?.step === 'all' || sessionUser?.step === '3'

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-8 px-5 py-10">
      <div className="text-center">
        <p className="text-base sm:text-lg font-bold text-gray-900">ระบบวางแผนผลิต</p>
        <p className="text-base sm:text-lg font-bold text-gray-900">โรงชำแหละสุกรพระพุทธบาท</p>
        {sessionUser && (
          <p className="text-sm text-gray-400 mt-1">ยินดีต้อนรับ {sessionUser.username} — เลือกโหมดการใช้งาน</p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm sm:max-w-md">
        {/* Step 2 */}
        <button
          onClick={() => canStep2 && router.push('/basic')}
          disabled={!canStep2}
          className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 py-8 sm:py-10 px-6 text-xl font-semibold transition-colors shadow-sm
            ${canStep2
              ? 'border-sky-500 bg-sky-500 text-white active:opacity-80 hover:bg-sky-600 hover:border-sky-600 cursor-pointer'
              : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
        >
          เบสิค
          <span className="text-sm font-normal opacity-80">(STEP 2)</span>
        </button>

        {/* Step 3 */}
        <button
          onClick={() => canStep3 && router.push('/home')}
          disabled={!canStep3}
          className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 py-8 sm:py-10 px-6 text-xl font-semibold transition-colors shadow-sm
            ${canStep3
              ? 'border-blue-600 bg-blue-600 text-white active:opacity-80 hover:bg-blue-700 hover:border-blue-700 cursor-pointer'
              : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
        >
          พิเศษ
          <span className="text-sm font-normal opacity-80">(STEP 3)</span>
        </button>
      </div>
    </div>
  )
}
