import type { Metadata, Viewport } from 'next'
import './globals.css'
import Sidebar from '@/components/Sidebar'

export const metadata: Metadata = {
  title: 'PPTB Production',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PPTB',
  },
}

export const viewport: Viewport = {
  themeColor: '#1f2937',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className="bg-gray-50">
        <div className="flex">
          <Sidebar />
          <main className="flex-1 min-h-screen mt-14 md:mt-0 p-3 sm:p-8 overflow-x-hidden overflow-y-auto">{children}</main>
        </div>
      </body>
    </html>
  )
}
