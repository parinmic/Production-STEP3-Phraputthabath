import { cookies } from 'next/headers'
import Sidebar from '@/components/Sidebar'
import UserStatusBar from '@/components/UserStatusBar'
import { SessionProvider, SessionUser } from '@/lib/session-context'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const raw = cookies().get('step3_session')?.value
  const user: SessionUser | null = raw ? JSON.parse(raw) : null

  return (
    <div className="flex">
      <Sidebar user={user} />
      <main className="flex-1 min-h-screen mt-14 md:mt-0 p-3 sm:p-8 overflow-x-hidden overflow-y-auto">
        <UserStatusBar user={user} />
        <SessionProvider user={user}>{children}</SessionProvider>
      </main>
    </div>
  )
}
