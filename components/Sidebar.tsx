'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ShoppingCart, BarChart3, ClipboardList, ChevronDown, ChevronRight, Factory, Package, UserCog, Calculator, PackageOpen, Layers, Store, Leaf, FileSpreadsheet, Menu, X, Scale, TrendingUp, ShieldAlert, CalendarPlus } from 'lucide-react'
import { useState, useEffect } from 'react'

const TABLES = [
  { label: 'Station สามชั้น', slug: 'sam-chan', dot: 'bg-blue-500' },
  { label: 'Station สะโพก',   slug: 'sa-phok', dot: 'bg-orange-500' },
  { label: 'Station ไหล่',    slug: 'lai',     dot: 'bg-green-500' },
]

const MANPOWER_TYPES = [
  { label: 'สะโพกพิเศษ',   slug: 'sa-phok-special', dot: 'bg-orange-500' },
  { label: 'ไหล่พิเศษ',    slug: 'lai-special',     dot: 'bg-green-500' },
  { label: 'สามชั้นพิเศษ', slug: 'sam-chan-special', dot: 'bg-blue-500' },
  { label: 'กำลังคนแนะนำ', slug: 'recommended',     dot: 'bg-pink-500' },
]

const CALCULATION_TYPES = [
  { label: 'Mas Productivity',          slug: 'mas-productivity',        dot: 'bg-purple-500' },
  { label: 'Mas %Variance Makro',       slug: 'mas-variance-makro',      dot: 'bg-blue-500' },
  { label: 'Mas %Variance Wet Market',  slug: 'mas-variance-wet-market', dot: 'bg-cyan-500' },
  { label: 'Mas LOTUS',                 slug: 'mas-lotus',               dot: 'bg-green-500' },
  { label: 'Mas Channel',               slug: 'mas-channel',             dot: 'bg-orange-500' },
  { label: 'Mas ตระกร้า',               slug: 'mas-trakra',              dot: 'bg-yellow-500' },
]

export default function Sidebar() {
  const p = usePathname()
  const [open, setOpen]                   = useState(p.startsWith('/production'))
  const [openWithdrawal, setOpenWithdrawal] = useState(p.startsWith('/withdrawal'))
  const [openManpower, setOpenManpower]   = useState(p.startsWith('/master-logic/manpower'))
  const [openCalculation, setOpenCalculation] = useState(p.startsWith('/master-logic/calculation'))
  const [collapsed, setCollapsed]         = useState(false)
  const [mobileOpen, setMobileOpen]       = useState(false)

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false) }, [p])

  const a = (href: string) =>
    p === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'

  // Label: always visible on mobile; hidden on desktop when collapsed
  const labelCls = collapsed ? 'md:hidden' : ''
  // Section heading: same
  const sectionCls = `text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3 ${collapsed ? 'md:hidden' : ''}`
  // Divider: only on desktop when collapsed
  const dividerCls = `border-t border-gray-700 my-2 hidden ${collapsed ? 'md:block' : ''}`

  return (
    <>
      {/* ── Mobile top bar ──────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-gray-900 text-white flex items-center gap-3 px-4 z-40 border-b border-gray-700 shrink-0">
        <button onClick={() => setMobileOpen(true)} className="p-1 -ml-1">
          <Menu size={22} />
        </button>
        <Factory size={20} className="text-blue-400" />
        <span className="font-bold text-sm">PPTB Production</span>
      </div>

      {/* ── Mobile backdrop ──────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={[
        'fixed inset-y-0 left-0 z-50 flex flex-col bg-gray-900 text-white transition-all duration-300 w-64',
        'md:relative md:inset-auto md:z-auto md:translate-x-0 md:shrink-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        collapsed ? 'md:w-16' : 'md:w-64',
      ].join(' ')}>

        {/* Header */}
        <div className="border-b border-gray-700">
          {/* Logo + title */}
          <div className="px-3 pt-5 pb-3 flex items-center gap-3 overflow-hidden">
            <Factory className="text-blue-400 shrink-0" size={26} />
            <div className={`overflow-hidden flex-1 ${labelCls}`}>
              <p className="font-bold text-sm whitespace-nowrap">PPTB Production</p>
              <p className="text-gray-400 text-xs whitespace-nowrap">Production Management</p>
            </div>
            {/* Mobile close button */}
            <button className="md:hidden ml-auto p-1 text-gray-400 hover:text-white" onClick={() => setMobileOpen(false)}>
              <X size={18} />
            </button>
          </div>
          {/* Hamburger toggle — desktop only, below title */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden md:flex w-full items-center py-2.5 px-3 text-gray-500 hover:text-white hover:bg-gray-800 transition-colors border-t border-gray-700/50 ${collapsed ? 'justify-center' : 'gap-2.5'}`}
          >
            <Menu size={18} />
            {!collapsed && <span className="text-xs text-gray-400">ย่อเมนู</span>}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/')}`} title="ภาพรวม">
            <LayoutDashboard size={18} className="shrink-0" />
            <span className={labelCls}>ภาพรวม</span>
          </Link>

          <p className={sectionCls}>คำสั่งเบิกและผลิต</p>
          <div className={dividerCls} />

          {/* รายการเบิกสินค้า */}
          <button
            onClick={() => setOpenWithdrawal(!openWithdrawal)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/withdrawal') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="รายการเบิกสินค้า"
          >
            <PackageOpen size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>รายการเบิกสินค้า</span>
            {!collapsed && (openWithdrawal ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openWithdrawal && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {[
                { label: 'Phase 1 (รอบเช้า)', slug: '1', dot: 'bg-blue-500' },
                { label: 'Phase 2 (รอบบ่าย)', slug: '2', dot: 'bg-orange-500' },
                { label: 'Phase 3 (แผน 100%)',  slug: '3', dot: 'bg-purple-500' },
              ].map((t) => (
                <Link key={t.slug} href={`/withdrawal/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/withdrawal/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {openWithdrawal && collapsed && (
            <div className="space-y-1 hidden md:block">
              {['1','2','3'].map((phase) => (
                <Link key={phase} href={`/withdrawal/${phase}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/withdrawal/${phase}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={`Phase ${phase}`}>
                  <span className="text-xs font-bold">P{phase}</span>
                </Link>
              ))}
            </div>
          )}

          {/* คำสั่งผลิตราย Station */}
          <button
            onClick={() => setOpen(!open)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/production') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="คำสั่งผลิตราย Station"
          >
            <ClipboardList size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>คำสั่งผลิตราย Station</span>
            {!collapsed && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {open && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {TABLES.map((t) => (
                <Link key={t.slug} href={`/production/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {open && collapsed && (
            <div className="space-y-1 hidden md:block">
              {TABLES.map((t) => (
                <Link key={t.slug} href={`/production/${t.slug}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={t.label}>
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                </Link>
              ))}
            </div>
          )}

          <p className={sectionCls}>อัพโหลดข้อมูล</p>
          <div className={dividerCls} />

          {[
            { href: '/workforce',          icon: Users,          label: 'กำลังคนประจำวัน' },
            { href: '/makro',              icon: ShoppingCart,   label: 'คำสั่งซื้อ Makro' },
            { href: '/lotus',              icon: Leaf,           label: 'คำสั่งซื้อ LOTUS' },
            { href: '/wet-market',         icon: Store,          label: 'คำสั่งซื้อ Wet Market' },
            { href: '/plan-100',           icon: FileSpreadsheet,label: 'แผนผลิต 100%' },
            { href: '/quota',              icon: BarChart3,      label: 'Quota ช่องทางขาย' },
            { href: '/supplementary-plan', icon: CalendarPlus,   label: 'แผนรอบเสริม' },
            { href: '/stock-raw-material', icon: Package,        label: 'Stock Raw Material' },
            { href: '/yield',              icon: TrendingUp,     label: 'รับผลได้' },
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
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/master-logic/manpower') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="กำลังคน"
          >
            <UserCog size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>กำลังคน</span>
            {!collapsed && (openManpower ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openManpower && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {MANPOWER_TYPES.map((t) => (
                <Link key={t.slug} href={`/master-logic/manpower/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/master-logic/manpower/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {openManpower && collapsed && (
            <div className="space-y-1 hidden md:block">
              {MANPOWER_TYPES.map((t) => (
                <Link key={t.slug} href={`/master-logic/manpower/${t.slug}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/master-logic/manpower/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={t.label}>
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                </Link>
              ))}
            </div>
          )}

          {/* Master Calculation */}
          <button
            onClick={() => setOpenCalculation(!openCalculation)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/master-logic/calculation') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
            title="Master Calculation"
          >
            <Calculator size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>Master Calculation</span>
            {!collapsed && (openCalculation ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openCalculation && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {CALCULATION_TYPES.map((t) => (
                <Link key={t.slug} href={`/master-logic/calculation/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/master-logic/calculation/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
              <Link href="/bom"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/bom' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-rose-500" />BOM สินค้า
              </Link>
              <Link href="/picking-unit"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/picking-unit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-yellow-500" />Mas หน่วยหยิบสินค้า
              </Link>
            </div>
          )}
          {openCalculation && collapsed && (
            <div className="space-y-1 hidden md:block">
              {CALCULATION_TYPES.map((t) => (
                <Link key={t.slug} href={`/master-logic/calculation/${t.slug}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/master-logic/calculation/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={t.label}>
                  <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                </Link>
              ))}
              <Link href="/bom"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/bom' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="BOM สินค้า">
                <Layers size={14} />
              </Link>
              <Link href="/picking-unit"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/picking-unit' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas หน่วยหยิบสินค้า">
                <Scale size={14} />
              </Link>
            </div>
          )}

          <p className={sectionCls}>Admin</p>
          <div className={dividerCls} />
          <Link href="/admin/production-plan"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/admin/production-plan')}`}
            title="จัดการแผนผลิต">
            <ShieldAlert size={18} className="shrink-0" />
            <span className={labelCls}>จัดการแผนผลิต</span>
          </Link>

        </nav>

        <div className={`px-6 py-4 border-t border-gray-700 text-gray-500 text-xs ${collapsed ? 'md:hidden' : ''}`}>
          PPTB Production
        </div>
      </aside>
    </>
  )
}
