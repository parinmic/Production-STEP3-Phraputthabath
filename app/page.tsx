'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, LogIn, ArrowLeft, ShieldCheck } from 'lucide-react'

export default function LandingPage() {
  const router = useRouter()
  const [selectedStep, setSelectedStep] = useState<null | 2 | 3>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const targetPath = selectedStep === 2 ? '/basic' : '/home'

  function resetForm() {
    setSelectedStep(null)
    setUsername('')
    setPassword('')
    setError('')
    setShowPassword(false)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, step: selectedStep }),
    })
    const data = await res.json()
    if (data.success) {
      router.push(targetPath)
    } else {
      setError(data.message ?? 'เข้าสู่ระบบไม่สำเร็จ')
      setLoading(false)
    }
  }

  async function handleAdminBypass() {
    const res = await fetch('/api/auth/admin-bypass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: selectedStep }),
    })
    const data = await res.json()
    if (data.success) router.push(data.redirectTo)
  }

  if (!selectedStep) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-8 px-5 py-10">
        <div>
          <p className="text-base sm:text-lg font-bold text-gray-900 text-center">ระบบวางแผนผลิต</p>
          <p className="text-base sm:text-lg font-bold text-gray-900 text-center">โรงชำแหละสุกรพระพุทธบาท</p>
          <p className="text-gray-400 text-sm text-center mt-1">เลือกโหมดการใช้งาน</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm sm:max-w-md">
          <button
            onClick={() => setSelectedStep(2)}
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-sky-500 bg-sky-500 text-white py-8 sm:py-10 px-6 text-xl font-semibold active:opacity-80 hover:bg-sky-600 hover:border-sky-600 transition-colors shadow-sm"
          >
            เบสิค
            <span className="text-sm font-normal opacity-80">(STEP 2)</span>
          </button>
          <button
            onClick={() => setSelectedStep(3)}
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-blue-600 bg-blue-600 text-white py-8 sm:py-10 px-6 text-xl font-semibold active:opacity-80 hover:bg-blue-700 hover:border-blue-700 transition-colors shadow-sm"
          >
            พิเศษ
            <span className="text-sm font-normal opacity-80">(STEP 3)</span>
          </button>
        </div>
      </div>
    )
  }

  const accentColor = selectedStep === 2 ? 'text-sky-600' : 'text-blue-600'
  const stepLabel   = selectedStep === 2 ? 'เบสิค (STEP 2)' : 'พิเศษ (STEP 3)'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 flex flex-col gap-6 relative">

        {/* Admin bypass */}
        <button
          onClick={handleAdminBypass}
          className="absolute top-4 right-4 flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors"
          title="Admin bypass — เข้าระบบโดยไม่ต้อง login"
        >
          <ShieldCheck size={13} />
          Admin
        </button>

        {/* Header */}
        <div className="text-center">
          <img src="/icon-transparent.png" alt="" className="w-10 h-10 mx-auto mb-3" />
          <p className="text-lg font-bold text-gray-900">ระบบวางแผนผลิต</p>
          <p className={`text-sm font-medium mt-0.5 ${accentColor}`}>ระบบ{stepLabel}</p>
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

        {/* Back */}
        <button onClick={resetForm}
          className="flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={14} />
          กลับเลือกระบบ
        </button>
      </div>
    </div>
  )
}
