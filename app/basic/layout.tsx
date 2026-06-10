'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ClipboardList, ChevronDown, ChevronRight, ChevronLeft, Undo2, Menu, X, ArrowLeft } from 'lucide-react'
import { useState, useEffect } from 'react'

const BASIC_STATIONS = [
  { label: 'Station สะโพกเบสิค',  slug: 'sa-phok-basic',  dot: 'bg-orange-500' },
  { label: 'Station ไหล่เบสิค',   slug: 'lai-basic',      dot: 'bg-green-500' },
  { label: 'Station สามชั้นเบสิค', slug: 'sam-chan-basic', dot: 'bg-blue-500' },
]

function BasicSidebar() {
  const p = usePathname()
  const [openStation, setOpenStation] = useState(p.startsWith('/basic/production'))
  const [collapsed, setCollapsed] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [p])

  const a = (href: string) =>
    p === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'

  const labelCls = collapsed ? 'md:hidden' : ''
  const dividerCls = `border-t border-gray-700 my-2 hidden ${collapsed ? 'md:block' : ''}`

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-gray-900 text-white flex items-center gap-3 px-4 z-40 border-b border-gray-700 shrink-0">
        <button onClick={() => setMobileOpen(true)} className="p-1 -ml-1">
          <Menu size={22} />
        </button>
        <img src="/icon-transparent.png" alt="" className="w-5 h-5 shrink-0" />
        <span className="font-bold text-sm">PPTB เบสิค</span>
      </div>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={[
        'fixed inset-y-0 left-0 z-50 flex flex-col bg-gray-900 text-white transition-all duration-300 w-64',
        'md:relative md:inset-auto md:z-auto md:translate-x-0 md:shrink-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        collapsed ? 'md:w-16' : 'md:w-64',
      ].join(' ')}>

        {/* Header */}
        <div className="border-b border-gray-700 flex items-center">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden md:flex flex-1 items-center py-3 px-3 text-gray-500 hover:text-white hover:bg-gray-800 transition-colors ${collapsed ? 'justify-center' : 'gap-2.5'}`}
          >
            {collapsed ? <Menu size={22} /> : <ChevronLeft size={22} />}
            {!collapsed && <span className="text-sm text-gray-400">ย่อเมนู</span>}
          </button>
          <button className="md:hidden flex items-center gap-2 py-3 px-3 text-gray-400 hover:text-white" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors bg-orange-500 text-white hover:bg-orange-600 ${collapsed ? 'md:justify-center' : ''}`} title="เลือกโหมดใช้งาน">
            <Undo2 size={18} className="shrink-0" />
            <span className={labelCls}>เลือกโหมดใช้งาน</span>
          </Link>
          <Link href="/basic" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/basic')}`} title="ภาพรวม">
            <LayoutDashboard size={18} className="shrink-0" />
            <span className={labelCls}>ภาพรวม</span>
          </Link>

          <div className={dividerCls} />

          {/* คำสั่งผลิตราย Station */}
          <button
            onClick={() => setOpenStation(!openStation)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/basic/production') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="คำสั่งผลิตราย Station"
          >
            <ClipboardList size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>คำสั่งผลิตราย Station</span>
            {!collapsed && (openStation ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openStation && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {BASIC_STATIONS.map((t) => (
                <Link key={t.slug} href={`/basic/production/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/basic/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {openStation && collapsed && (
            <div className="space-y-1 hidden md:block">
              {BASIC_STATIONS.map((t) => (
                <Link key={t.slug} href={`/basic/production/${t.slug}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/basic/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={t.label}>
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* Back to landing */}
        <div className="border-t border-gray-700 px-2 py-3">
          <Link href="/"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors ${collapsed ? 'md:justify-center' : ''}`}
            title="กลับหน้าหลัก">
            <ArrowLeft size={18} className="shrink-0" />
            <span className={labelCls}>กลับหน้าหลัก</span>
          </Link>
        </div>
      </aside>
    </>
  )
}

export default function BasicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      <BasicSidebar />
      <main className="flex-1 min-h-screen mt-14 md:mt-0 p-3 sm:p-8 overflow-x-hidden overflow-y-auto">{children}</main>
    </div>
  )
}
