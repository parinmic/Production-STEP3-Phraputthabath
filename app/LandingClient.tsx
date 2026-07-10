'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

interface SessionUser { step: string; menus: string[]; username: string; position: string }

export default function LandingClient({ initialUser }: { initialUser: SessionUser | null }) {
  const router = useRouter()
  const [sessionUser, setSession] = useState<SessionUser | null>(initialUser)

  // Login is disabled for now: auto-establish an admin session instead of showing the login form.
  useEffect(() => {
    if (sessionUser) return
    fetch('/api/auth/admin-bypass', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSession(data.user)
          router.refresh()
        }
      })
  }, [sessionUser, router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setSession(null)
    router.refresh()
  }

  if (!sessionUser) {
    return <div className="min-h-screen bg-white" />
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
          <p className="text-sm text-gray-400 mt-1">
            ยินดีต้อนรับ <span className="font-medium text-gray-600">{sessionUser.username}</span> — เลือกโหมดการใช้งาน
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm sm:max-w-md">
        <button
          onClick={() => canStep2 && router.push('/basic')}
          disabled={!canStep2}
          className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 py-8 sm:py-10 px-6 text-xl font-semibold transition-colors shadow-sm
            ${canStep2
              ? 'border-sky-500 bg-sky-500 text-white active:opacity-80 hover:bg-sky-600 hover:border-sky-600 cursor-pointer'
              : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        >
          เบสิค
          <span className="text-sm font-normal opacity-80">(STEP 2)</span>
        </button>

        <button
          onClick={() => canStep3 && router.push('/home')}
          disabled={!canStep3}
          className={`flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 py-8 sm:py-10 px-6 text-xl font-semibold transition-colors shadow-sm
            ${canStep3
              ? 'border-blue-600 bg-blue-600 text-white active:opacity-80 hover:bg-blue-700 hover:border-blue-700 cursor-pointer'
              : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        >
          พิเศษ
          <span className="text-sm font-normal opacity-80">(STEP 3)</span>
        </button>
      </div>

      <button
        onClick={handleLogout}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-500 transition-colors"
      >
        <LogOut size={15} />
        ออกจากระบบ
      </button>
    </div>
  )
}
