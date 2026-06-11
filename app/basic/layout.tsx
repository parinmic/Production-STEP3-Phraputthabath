'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ShoppingCart, ClipboardList, ChevronDown, ChevronRight, ChevronLeft, Package, UserCog, Calculator, Layers, Store, Leaf, FileSpreadsheet, Menu, Scale, TrendingUp, ShieldAlert, CalendarPlus, CalendarDays, Ban, AlertTriangle, ArrowLeft } from 'lucide-react'
import { useState, useEffect } from 'react'

const BASIC_STATIONS = [
  { label: 'Station สะโพกเบสิค',  slug: 'sa-phok-basic',  dot: 'bg-orange-500' },
  { label: 'Station ไหล่เบสิค',   slug: 'lai-basic',      dot: 'bg-green-500' },
  { label: 'Station สามชั้นเบสิค', slug: 'sam-chan-basic', dot: 'bg-blue-500' },
]

const MANPOWER_TYPES = [
  { label: 'สะโพกพิเศษ',   slug: 'sa-phok-special',  dot: 'bg-orange-500' },
  { label: 'ไหล่พิเศษ',    slug: 'lai-special',      dot: 'bg-green-500' },
  { label: 'สามชั้นพิเศษ', slug: 'sam-chan-special',  dot: 'bg-blue-500' },
  { label: 'หมูบดพิเศษ',   slug: 'moo-chod-special', dot: 'bg-red-500' },
  { label: 'สไลด์พิเศษ',   slug: 'slide-special',    dot: 'bg-purple-500' },
  { label: 'กำลังคนแนะนำ', slug: 'recommended',      dot: 'bg-pink-500' },
]

const CALCULATION_TYPES = [
  { label: 'Mas Productivity Basic',         slug: 'mas-productivity-basic',        dot: 'bg-purple-500' },
  { label: 'Mas Channel Basic',              slug: 'mas-channel-basic',             dot: 'bg-orange-500' },
  { label: 'Mas %Variance Makro Basic',      slug: 'mas-variance-makro-basic',      dot: 'bg-blue-500' },
  { label: 'Mas %Variance Wet Market Basic', slug: 'mas-variance-wet-market-basic', dot: 'bg-cyan-500' },
  { label: 'Mas %Variance LOTUS Basic',      slug: 'mas-variance-lotus-basic',      dot: 'bg-lime-500' },
  { label: 'Mas Special Basic',              slug: 'mas-special-basic',             dot: 'bg-pink-500' },
  { label: 'Mas สายพาน',                    slug: 'mas-saipan',                    dot: 'bg-yellow-500' },
  { label: 'Mas ตะกร้า Raw',                slug: 'mas-raw-basket',                dot: 'bg-amber-500' },
]

function BasicSidebar() {
  const p = usePathname()
  const [open, setOpen]                       = useState(p.startsWith('/basic/production'))
  const [openShortage, setOpenShortage]       = useState(p.startsWith('/basic/shortage'))
  const [openWorkforce, setOpenWorkforce]     = useState(p.startsWith('/basic/workforce'))
  const [openManpower, setOpenManpower]       = useState(p.startsWith('/basic/master-logic/manpower'))
  const [openCalculation, setOpenCalculation] = useState(p.startsWith('/basic/master-logic/calculation'))
  const [collapsed, setCollapsed]             = useState(true)
  const [mobileOpen, setMobileOpen]           = useState(false)

  useEffect(() => { setMobileOpen(false) }, [p])

  const a = (href: string) =>
    p === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'

  const labelCls = collapsed ? 'md:hidden' : ''
  const sectionCls = `text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3 ${collapsed ? 'md:hidden' : ''}`
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
          <button className="md:hidden flex flex-1 items-center gap-2.5 py-3 px-3 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors" onClick={() => setMobileOpen(false)}>
            <ChevronLeft size={22} />
            <span className="text-sm">ย่อเมนู</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          <Link href="/basic" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/basic')}`} title="ภาพรวม">
            <LayoutDashboard size={18} className="shrink-0" />
            <span className={labelCls}>ภาพรวม</span>
          </Link>

          <p className={sectionCls}>คำสั่งเบิกและผลิต</p>
          <div className={dividerCls} />

          {/* รายการ Raw รอผลิต */}
          <button
            onClick={() => setOpenShortage(!openShortage)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/basic/shortage') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="รายการ Raw รอผลิต"
          >
            <AlertTriangle size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>รายการ Raw รอผลิต</span>
            {!collapsed && (openShortage ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openShortage && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {[
                { label: 'Phase 1 (รอบเช้า)', slug: '1', dot: 'bg-blue-500' },
                { label: 'Phase 2 (รอบบ่าย)', slug: '2', dot: 'bg-orange-500' },
                { label: 'Phase 3 (แผน 100%)',  slug: '3', dot: 'bg-purple-500' },
              ].map((t) => (
                <Link key={t.slug} href={`/basic/shortage/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/basic/shortage/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {openShortage && collapsed && (
            <div className="space-y-1 hidden md:block">
              {['1','2','3'].map((phase) => (
                <Link key={phase} href={`/basic/shortage/${phase}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/basic/shortage/${phase}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={`Shortage Phase ${phase}`}>
                  <span className="text-xs font-bold">S{phase}</span>
                </Link>
              ))}
            </div>
          )}

          {/* คำสั่งผลิตราย Station */}
          <button
            onClick={() => setOpen(!open)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/basic/production') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="คำสั่งผลิตราย Station"
          >
            <ClipboardList size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>คำสั่งผลิตราย Station</span>
            {!collapsed && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {open && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {BASIC_STATIONS.map((t) => (
                <Link key={t.slug} href={`/basic/production/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/basic/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {open && collapsed && (
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

          <Link href="/basic/workforce-daily-status"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/basic/workforce-daily-status')}`}
            title="ตรวจสอบสถานะกำลังคนประจำวัน">
            <CalendarDays size={18} className="shrink-0" />
            <span className={labelCls}>ตรวจสอบสถานะกำลังคน</span>
          </Link>

          <div className="hidden md:block space-y-1">

          <p className={sectionCls}>อัพโหลดข้อมูล</p>
          <div className={dividerCls} />

          {/* กำลังคนประจำวัน */}
          <button
            onClick={() => setOpenWorkforce(!openWorkforce)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/basic/workforce') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="กำลังคนประจำวัน"
          >
            <Users size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>กำลังคนประจำวัน</span>
            {!collapsed && (openWorkforce ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openWorkforce && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              <Link href="/basic/workforce"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/workforce' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-blue-500" />อัพโหลดกำลังคนประจำวัน
              </Link>
              <Link href="/basic/workforce/weekly"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/workforce/weekly' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-teal-500" />แผนเข้างานประจำสัปดาห์
              </Link>
            </div>
          )}
          {openWorkforce && collapsed && (
            <div className="space-y-1 hidden md:block">
              <Link href="/basic/workforce"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/workforce' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="อัพโหลดกำลังคนประจำวัน">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
              </Link>
              <Link href="/basic/workforce/weekly"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/workforce/weekly' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="แผนเข้างานประจำสัปดาห์">
                <span className="w-2 h-2 rounded-full bg-teal-500" />
              </Link>
            </div>
          )}

          {[
            { href: '/basic/makro',              icon: ShoppingCart,    label: 'คำสั่งซื้อ Makro' },
            { href: '/basic/lotus',              icon: Leaf,            label: 'คำสั่งซื้อ LOTUS' },
            { href: '/basic/wet-market',         icon: Store,           label: 'คำสั่งซื้อ Wet Market' },
            { href: '/basic/plan-100',           icon: FileSpreadsheet, label: 'แผนผลิต 100%' },
            { href: '/basic/supplementary-plan', icon: CalendarPlus,    label: 'แผนรอบเสริม' },
            { href: '/basic/stock-raw-material', icon: Package,         label: 'Stock Raw Material' },
            { href: '/basic/yield',              icon: TrendingUp,      label: 'รับผลได้' },
          ].map((m) => (
            <Link key={m.href} href={m.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a(m.href)}`}
              title={m.label}>
              <m.icon size={18} className="shrink-0" />
              <span className={labelCls}>{m.label}</span>
            </Link>
          ))}

          <p className={sectionCls}>Master Logic การสร้างแผนผลิต</p>
          <div className={dividerCls} />

          {/* กำลังคน */}
          <button
            onClick={() => setOpenManpower(!openManpower)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/basic/master-logic/manpower') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="กำลังคน"
          >
            <UserCog size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>กำลังคน</span>
            {!collapsed && (openManpower ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openManpower && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {MANPOWER_TYPES.map((t) => (
                <Link key={t.slug} href={`/basic/master-logic/manpower/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/basic/master-logic/manpower/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {openManpower && collapsed && (
            <div className="space-y-1 hidden md:block">
              {MANPOWER_TYPES.map((t) => (
                <Link key={t.slug} href={`/basic/master-logic/manpower/${t.slug}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/basic/master-logic/manpower/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={t.label}>
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                </Link>
              ))}
            </div>
          )}

          {/* Master Calculation */}
          <button
            onClick={() => setOpenCalculation(!openCalculation)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/basic/master-logic/calculation') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="Master Calculation"
          >
            <Calculator size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>Master Calculation</span>
            {!collapsed && (openCalculation ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openCalculation && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {CALCULATION_TYPES.map((t) => (
                <Link key={t.slug} href={`/basic/master-logic/calculation/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/basic/master-logic/calculation/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
              <Link href="/basic/bom"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/bom' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-rose-500" />BOM สินค้า
              </Link>
              <Link href="/basic/picking-unit"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/picking-unit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-yellow-500" />Mas หน่วยหยิบสินค้า
              </Link>
              <Link href="/basic/no-withdrawal"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/no-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-teal-500" />Mas SKU ไม่ต้องเบิก
              </Link>
              <Link href="/basic/master-logic/moo-chod"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/master-logic/moo-chod' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-red-500" />Mas หมูบด (%ไขมัน)
              </Link>
              <Link href="/basic/master-logic/moo-chod-withdrawal"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/master-logic/moo-chod-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-red-400" />Mas เบิกหมูบด
              </Link>
              <Link href="/basic/mas-yield"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/basic/mas-yield' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-emerald-500" />Mas Yield
              </Link>
            </div>
          )}
          {openCalculation && collapsed && (
            <div className="space-y-1 hidden md:block">
              {CALCULATION_TYPES.map((t) => (
                <Link key={t.slug} href={`/basic/master-logic/calculation/${t.slug}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/basic/master-logic/calculation/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={t.label}>
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                </Link>
              ))}
              <Link href="/basic/mas-yield"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/mas-yield' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas Yield">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
              </Link>
              <Link href="/basic/bom"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/bom' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="BOM สินค้า">
                <Layers size={14} />
              </Link>
              <Link href="/basic/picking-unit"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/picking-unit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas หน่วยหยิบสินค้า">
                <Scale size={14} />
              </Link>
              <Link href="/basic/no-withdrawal"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/no-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas SKU ไม่ต้องเบิก">
                <Ban size={14} />
              </Link>
              <Link href="/basic/master-logic/moo-chod"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/master-logic/moo-chod' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas หมูบด (%ไขมัน)">
                <span className="w-2 h-2 rounded-full bg-red-500" />
              </Link>
              <Link href="/basic/master-logic/moo-chod-withdrawal"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/basic/master-logic/moo-chod-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas เบิกหมูบด">
                <span className="w-2 h-2 rounded-full bg-red-400" />
              </Link>
            </div>
          )}

          <p className={sectionCls}>Admin</p>
          <div className={dividerCls} />
          <Link href="/basic/admin/production-plan"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/basic/admin/production-plan')}`}
            title="จัดการแผนผลิต">
            <ShieldAlert size={18} className="shrink-0" />
            <span className={labelCls}>จัดการแผนผลิต</span>
          </Link>

          </div>{/* end hidden md:block */}

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
