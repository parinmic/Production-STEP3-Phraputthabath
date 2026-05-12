import type { Metadata } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'
export const metadata: Metadata = { title: 'ระบบคำสั่งผลิต | CP Foods' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-gray-50">
        <div className="flex">
          <Sidebar />
          <main className="flex-1 min-h-screen p-8 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}
