import { NextRequest, NextResponse } from 'next/server'
import {
  canAccessSpecialStation, SPECIAL_STATION_MENU_NUMBER,
  canAccessBasicStation, BASIC_STATION_MENU_NUMBER,
} from '@/lib/special-menu'

const SESSION_COOKIE = 'step3_session'

// Landing/login screens themselves — must stay reachable with no session.
const PUBLIC_PATHS = ['/', '/login']

// API prefixes that must work before a session exists (login itself, and
// external cron triggers which authenticate via CRON_SECRET instead).
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/cron/']

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

interface SessionUser {
  username?: string
  step?: string
  menus?: string[]
}

function getSessionUser(req: NextRequest): SessionUser | null {
  const raw = req.cookies.get(SESSION_COOKIE)?.value
  if (!raw) return null
  try {
    const user = JSON.parse(raw)
    if (user && user.username && user.step) return user
  } catch {
    // fall through
  }
  return null
}

const LOGIN_ENFORCEMENT_ENABLED = true

export function middleware(req: NextRequest) {
  if (!LOGIN_ENFORCEMENT_ENABLED) {
    return NextResponse.next()
  }

  const { pathname } = req.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const user = getSessionUser(req)

  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, message: 'กรุณาเข้าสู่ระบบ' },
        { status: 401 }
      )
    }
    return NextResponse.redirect(new URL('/', req.url))
  }

  // Page-level step gating: /basic/* pages are STEP 2, everything else is
  // STEP 3. API routes are shared between the two steps (e.g. /api/admin/users,
  // /api/production, /api/master/*) so they are only gated on login above,
  // not on step.
  if (!pathname.startsWith('/api/') && user.step !== 'all') {
    const isBasicPage = pathname.startsWith('/basic')
    const allowed = isBasicPage ? user.step === '2' : user.step === '3'
    if (!allowed) {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  // Station-level gating: /production/<slug> (special) and /basic/production/<slug>
  // (basic) — a position restricted to specific stations cannot open another
  // station's page directly by URL. Both sides use the numeric menu scheme
  // from the "Detail" sheet of "User ระบบผลิต.xlsx" (e.g. "2.1", "15.1").
  const specialStation = pathname.match(/^\/production\/([^/]+)$/)
  if (specialStation && specialStation[1] in SPECIAL_STATION_MENU_NUMBER) {
    if (!canAccessSpecialStation(user.menus, specialStation[1])) {
      return NextResponse.redirect(new URL('/home', req.url))
    }
  }

  const basicStation = pathname.match(/^\/basic\/production\/([^/]+)$/)
  if (basicStation && basicStation[1] in BASIC_STATION_MENU_NUMBER) {
    if (!canAccessBasicStation(user.menus, basicStation[1])) {
      return NextResponse.redirect(new URL('/basic', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
}
