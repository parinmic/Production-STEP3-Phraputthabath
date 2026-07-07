'use client'
import { createContext, useContext } from 'react'
import { canEditSpecialMenu } from '@/lib/special-menu'

export interface SessionUser {
  id: string
  username: string
  position: string
  menus: string[]
  editMenus: string[]
  step: string
}

const SessionContext = createContext<SessionUser | null>(null)

export function SessionProvider({ user, children }: { user: SessionUser | null; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
}

export function useSessionUser(): SessionUser | null {
  return useContext(SessionContext)
}

// เมนูที่ user เห็นแค่ "View" (ไม่มีใน editMenus) — ใช้ซ่อน/ปิดปุ่มที่แก้ไขข้อมูลได้ในหน้านั้น
// menuKey เป็น undefined หมายถึงหน้านี้ยังไม่มีเลขเมนูกำหนดสิทธิ์ (ไม่มีลิงก์ใน sidebar) — ให้แก้ไขได้เสมอ ไม่ block
export function useCanEdit(menuKey: string | undefined): boolean {
  const user = useSessionUser()
  if (menuKey == null) return true
  return canEditSpecialMenu(user?.editMenus, menuKey)
}
