import { cookies } from 'next/headers'
import LandingClient from './LandingClient'

interface SessionUser { step: string; menus: string[]; username: string; position: string }

export default function LandingPage() {
  const raw = cookies().get('step3_session')?.value
  const initialUser: SessionUser | null = raw ? JSON.parse(raw) : null
  return <LandingClient initialUser={initialUser} />
}
