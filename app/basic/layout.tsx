import { cookies } from 'next/headers'
import BasicSidebar from '@/components/BasicSidebar'
import UserStatusBar from '@/components/UserStatusBar'
import { SessionProvider, SessionUser } from '@/lib/session-context'

export default function BasicLayout({ children }: { children: React.ReactNode }) {
  const raw = cookies().get('step3_session')?.value
  const user: SessionUser | null = raw ? JSON.parse(raw) : null

  return (
    <div className="flex">
      <BasicSidebar user={user} />
      <main className="flex-1 min-h-screen mt-14 md:mt-0 p-3 sm:p-8 overflow-x-hidden overflow-y-auto">
        <UserStatusBar user={user} />
        <SessionProvider user={user}>{children}</SessionProvider>
      </main>
    </div>
  )
}
