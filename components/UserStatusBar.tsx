'use client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

interface SessionUser { username: string; position: string }

export default function UserStatusBar({ user }: { user: SessionUser | null }) {
  const router = useRouter()
  if (!user) return null

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  return (
    <div className="flex items-center justify-end gap-3 mb-4">
      <button
        onClick={handleLogout}
        title="ออกจากระบบ"
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"
      >
        <LogOut size={14} />
        ออกจากระบบ
      </button>
      <div className="text-right">
        <p className="text-sm font-semibold text-gray-800">{user.username}</p>
        <p className="text-xs text-gray-500 mt-0.5">{user.position}</p>
      </div>
    </div>
  )
}
