'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, Users, BarChart3, ClipboardList, ChevronDown, ChevronRight, ChevronLeft, Package, Calculator, PackageOpen, Layers, Menu, X, Scale, TrendingUp, ShieldAlert, CalendarPlus, CalendarDays, Ban, AlertTriangle, ArrowLeft, Beef, Scissors, LogOut, BookOpen, Slice } from 'lucide-react'
import { useState, useEffect } from 'react'
import { hasSpecialMenu, canAccessSpecialStation } from '@/lib/special-menu'

interface SessionUser { id: string; username: string; position: string; menus: string[] }

const TABLES = [
  { label: 'Station สามชั้น', slug: 'sam-chan',  dot: 'bg-blue-500' },
  { label: 'Station สะโพก',   slug: 'sa-phok',  dot: 'bg-orange-500' },
  { label: 'Station ไหล่',    slug: 'lai',      dot: 'bg-green-500' },
  { label: 'Station หมูบด',   slug: 'moo-chod', dot: 'bg-red-500' },
  { label: 'Station สไลด์',   slug: 'slide',    dot: 'bg-purple-500' },
  { label: 'Station เผาขา',   slug: 'pao-kha',  dot: 'bg-fuchsia-500' },
  { label: 'Station เลาะขา',  slug: 'loa-kha',  dot: 'bg-teal-500' },
]

const CALCULATION_TYPES = [
  { label: 'Mas Productivity',          slug: 'mas-productivity',        dot: 'bg-purple-500' },
  { label: 'Mas %Variance Makro',       slug: 'mas-variance-makro',      dot: 'bg-blue-500' },
  { label: 'Mas %Variance Wet Market',  slug: 'mas-variance-wet-market', dot: 'bg-cyan-500' },
  { label: 'Mas %Variance LOTUS',       slug: 'mas-variance-lotus',      dot: 'bg-lime-500' },
  { label: 'Mas LOTUS',                 slug: 'mas-lotus',               dot: 'bg-green-500' },
  { label: 'Mas Channel',               slug: 'mas-channel',             dot: 'bg-orange-500' },
  { label: 'Mas ตระกร้า',               slug: 'mas-trakra',              dot: 'bg-yellow-500' },
  { label: 'Mas Special',               slug: 'mas-special',             dot: 'bg-pink-500' },
  { label: 'Mas Sku ผลิตพร้อมกัน',     slug: 'mas-sku-concurrent',      dot: 'bg-teal-500' },
  // { label: 'Mas Raw Material',          slug: 'mas-raw-material',        dot: 'bg-red-500' },
]

// เมนูที่ไม่มีสิทธิ์: แสดงให้เห็นเหมือนเดิม แต่จางลงและกดเข้าไม่ได้
const DISABLED_CLS = 'text-gray-600 opacity-40 cursor-not-allowed pointer-events-none'

function NavLink({ href, allowed, className, title, children }: {
  href: string; allowed: boolean; className: string; title?: string; children: React.ReactNode
}) {
  if (!allowed) {
    return <div className={className} title={title} aria-disabled="true">{children}</div>
  }
  return <Link href={href} className={className} title={title}>{children}</Link>
}

export default function Sidebar({ user }: { user: SessionUser | null }) {
  const p = usePathname()
  const router = useRouter()

  // ตรวจสอบสิทธิ์เมนู: null = ยังไม่ได้ login (แสดงทั้งหมด), 'all' = ทั้งหมด
  // key เป็นหมายเลขตามชีท Detail ของไฟล์ "User ระบบผลิต.xlsx"
  const has = (key: string) => hasSpecialMenu(user?.menus, key)

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }
  const [open, setOpen]                   = useState(p.startsWith('/production'))
  const [openWithdrawal, setOpenWithdrawal] = useState(p.startsWith('/withdrawal'))
  const [openShortage, setOpenShortage]   = useState(p.startsWith('/shortage'))
  const [openCalculation, setOpenCalculation] = useState(p.startsWith('/master-logic/calculation'))
  const [collapsed, setCollapsed]         = useState(true)
  const [mobileOpen, setMobileOpen]       = useState(false)

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false) }, [p])

  const linkCls = (href: string, allowed: boolean) =>
    !allowed ? DISABLED_CLS : (p === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white')

  const groupCls = (activePrefix: boolean, allowed: boolean) =>
    !allowed ? DISABLED_CLS : (activePrefix ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800')

  // Label: always visible on mobile; hidden on desktop when collapsed
  const labelCls = collapsed ? 'md:hidden' : ''
  // Section heading: same
  const sectionCls = `text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3 ${collapsed ? 'md:hidden' : ''}`
  // Divider: only on desktop when collapsed
  const dividerCls = `border-t border-gray-700 my-2 hidden ${collapsed ? 'md:block' : ''}`

  const canWithdrawal = has('1')
  const canProduction = TABLES.some((t) => canAccessSpecialStation(user?.menus, t.slug))
  const canSawMachine  = has('3')
  const canShortage    = has('4')
  const canAll         = has('all')

  return (
    <>
      {/* ── Mobile top bar ──────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-gray-900 text-white flex items-center gap-3 px-4 z-40 border-b border-gray-700 shrink-0">
        <button onClick={() => setMobileOpen(true)} className="p-1 -ml-1">
          <Menu size={22} />
        </button>
        <div className="flex items-center gap-3">
          <img src="/icon-transparent.png" alt="" className="w-5 h-5 shrink-0" />
          <span className="font-bold text-sm">PPTB Production</span>
        </div>
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
          <Link href="/home" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p === '/home' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`} title="ภาพรวม">
            <LayoutDashboard size={18} className="shrink-0" />
            <span className={labelCls}>ภาพรวม</span>
          </Link>

          <NavLink href="/executive-dashboard" allowed={has('0')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/executive-dashboard', has('0'))}`}
            title="Dashboard บริหาร">
            <BarChart3 size={18} className="shrink-0" />
            <span className={labelCls}>Dashboard บริหาร</span>
          </NavLink>

          <p className={sectionCls}>คำสั่งเบิกและผลิต</p>
          <div className={dividerCls} />

          {/* รายการเบิกสินค้า */}
          <button
            onClick={() => canWithdrawal && setOpenWithdrawal(!openWithdrawal)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${groupCls(p.startsWith('/withdrawal'), canWithdrawal)}`}
            title="รายการเบิกสินค้า"
          >
            <PackageOpen size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>รายการเบิกสินค้า</span>
            {canWithdrawal && !collapsed && (openWithdrawal ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>
          {openWithdrawal && canWithdrawal && (
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
          {openWithdrawal && canWithdrawal && collapsed && (
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
            onClick={() => canProduction && setOpen(!open)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${groupCls(p.startsWith('/production'), canProduction)}`}
            title="คำสั่งผลิตราย Station"
          >
            <ClipboardList size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>คำสั่งผลิตราย Station</span>
            {canProduction && !collapsed && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>
          {open && canProduction && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {TABLES.map((t) => {
                const canStation = canAccessSpecialStation(user?.menus, t.slug)
                return (
                  <NavLink key={t.slug} href={`/production/${t.slug}`} allowed={canStation}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      !canStation ? DISABLED_CLS : (p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white')
                    }`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                  </NavLink>
                )
              })}
            </div>
          )}
          {open && canProduction && collapsed && (
            <div className="space-y-1 hidden md:block">
              {TABLES.map((t) => {
                const canStation = canAccessSpecialStation(user?.menus, t.slug)
                return (
                  <NavLink key={t.slug} href={`/production/${t.slug}`} allowed={canStation}
                    className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${
                      !canStation ? DISABLED_CLS : (p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white')
                    }`}
                    title={t.label}>
                    <span className={`w-2 h-2 rounded-full ${t.dot}`} />
                  </NavLink>
                )
              })}
            </div>
          )}

          <NavLink href="/saw-machine-plan" allowed={canSawMachine}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/saw-machine-plan', canSawMachine)}`}
            title="แผนการใช้เครื่องเลื่อย">
            <Scissors size={18} className="shrink-0" />
            <span className={labelCls}>แผนการใช้เครื่องเลื่อย</span>
          </NavLink>

          <NavLink href="/breakline" allowed={has('16')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/breakline', has('16'))}`}
            title="Breakline">
            <Slice size={18} className="shrink-0" />
            <span className={labelCls}>Breakline</span>
          </NavLink>

          <NavLink href="/workforce-daily-status" allowed={canAll}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/workforce-daily-status', canAll)}`}
            title="ตรวจสอบสถานะกำลังคน (ดูอย่างเดียว)">
            <CalendarDays size={18} className="shrink-0" />
            <span className={labelCls}>ตรวจสอบสถานะกำลังคน</span>
          </NavLink>

          <NavLink href="/wip-plan" allowed={has('5')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/wip-plan', has('5'))}`}
            title="แผนผลิต WIP">
            <Layers size={18} className="shrink-0" />
            <span className={labelCls}>แผนผลิต WIP</span>
          </NavLink>

          {/* รายการ Raw รอผลิต */}
          <button
            onClick={() => canShortage && setOpenShortage(!openShortage)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${groupCls(p.startsWith('/shortage'), canShortage)}`}
            title="รายการ Raw รอผลิต"
          >
            <AlertTriangle size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>รายการ Raw รอผลิต</span>
            {canShortage && !collapsed && (openShortage ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>
          {openShortage && canShortage && (
            <div className={`ml-4 space-y-1 ${collapsed ? 'md:hidden' : ''}`}>
              {[
                { label: 'Phase 1 (รอบเช้า)', slug: '1', dot: 'bg-blue-500' },
                { label: 'Phase 2 (รอบบ่าย)', slug: '2', dot: 'bg-orange-500' },
                { label: 'Phase 3 (แผน 100%)',  slug: '3', dot: 'bg-purple-500' },
              ].map((t) => (
                <Link key={t.slug} href={`/shortage/${t.slug}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/shortage/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
                </Link>
              ))}
            </div>
          )}
          {openShortage && canShortage && collapsed && (
            <div className="space-y-1 hidden md:block">
              {['1','2','3'].map((phase) => (
                <Link key={phase} href={`/shortage/${phase}`}
                  className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/shortage/${phase}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                  title={`Shortage Phase ${phase}`}>
                  <span className="text-xs font-bold">S{phase}</span>
                </Link>
              ))}
            </div>
          )}

          <NavLink href="/withdrawal/rm-allocation" allowed={has('6')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/withdrawal/rm-allocation', has('6'))}`}
            title="จัดสรรเนื้อ Raw Mat">
            <Beef size={18} className="shrink-0" />
            <span className={labelCls}>จัดสรรเนื้อ Raw Mat</span>
          </NavLink>

          <div className="hidden md:block space-y-1">

          <p className={sectionCls}>อัพโหลดข้อมูล</p>
          <div className={dividerCls} />

          <NavLink href="/upload-overview" allowed={has('7.1') || has('7.2') || has('7.3') || has('7.4') || has('7.5')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/upload-overview', has('7.1') || has('7.2') || has('7.3') || has('7.4') || has('7.5'))}`}
            title="อัพโหลดคำสั่งซื้อ">
            <Layers size={18} className="shrink-0" />
            <span className={labelCls}>อัพโหลดคำสั่งซื้อ</span>
          </NavLink>

          {[
            { href: '/supplementary-plan', icon: CalendarPlus,   label: 'แผนรอบเสริม',         key: '7.6' },
            { href: '/stock-raw-material', icon: Package,        label: 'Stock Raw Material',  key: '8'   },
            { href: '/yield',              icon: TrendingUp,     label: 'รับผลได้',            key: '9'   },
          ].map((m) => (
            <NavLink key={m.href} href={m.href} allowed={has(m.key)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls(m.href, has(m.key))}`}
              title={m.label}>
              <m.icon size={18} className="shrink-0" />
              <span className={labelCls}>{m.label}</span>
            </NavLink>
          ))}

          <p className={sectionCls}>Master Logic การสร้างแผนผลิต</p>
          <div className={dividerCls} />

          {/* Master Calculation */}
          <button
            onClick={() => has('10.2') && setOpenCalculation(!openCalculation)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${groupCls(p.startsWith('/master-logic/calculation'), has('10.2'))}`}
            title="Master Calculation"
          >
            <Calculator size={18} className="shrink-0" />
            <span className={`flex-1 text-left ${labelCls}`}>Master Calculation</span>
            {has('10.2') && !collapsed && (openCalculation ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
          </button>

          {openCalculation && has('10.2') && (
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
              <Link href="/no-withdrawal"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/no-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-teal-500" />Mas SKU ไม่ต้องเบิก
              </Link>
              <Link href="/master-logic/moo-chod"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/moo-chod' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-red-500" />Mas หมูบด (%ไขมัน)
              </Link>
              <Link href="/master-logic/moo-chod-withdrawal"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/moo-chod-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-red-400" />Mas เบิกหมูบด
              </Link>
              <Link href="/master-logic/priority-withdrawal"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/priority-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-indigo-500" />Mas Priority เบิก RM
              </Link>
              <Link href="/master-logic/raw-advance"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/raw-advance' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-orange-500" />Mas ผลิต Raw ล่วงหน้า
              </Link>
              <Link href="/master-logic/saw-machine"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/saw-machine' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-teal-400" />Mas SKU ใช้เครื่องเลื่อย
              </Link>
              <Link href="/master-logic/phlit-tor-kan"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/phlit-tor-kan' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-rose-400" />Mas ผลิตต่อกัน
              </Link>
              <Link href="/master-logic/special-raw"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/special-raw' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-amber-500" />Mas Special Raw
              </Link>
              <Link href="/master-logic/bom-special"
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === '/master-logic/bom-special' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className="w-2 h-2 rounded-full shrink-0 bg-violet-500" />BOM พิเศษ
              </Link>
            </div>
          )}
          {openCalculation && has('10.2') && collapsed && (
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
              <Link href="/no-withdrawal"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/no-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas SKU ไม่ต้องเบิก">
                <Ban size={14} />
              </Link>
              <Link href="/master-logic/moo-chod"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/moo-chod' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas หมูบด (%ไขมัน)">
                <span className="w-2 h-2 rounded-full bg-red-500" />
              </Link>
              <Link href="/master-logic/moo-chod-withdrawal"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/moo-chod-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas เบิกหมูบด">
                <span className="w-2 h-2 rounded-full bg-red-400" />
              </Link>
              <Link href="/master-logic/priority-withdrawal"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/priority-withdrawal' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas Priority เบิก RM">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
              </Link>
              <Link href="/master-logic/raw-advance"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/raw-advance' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas ผลิต Raw ล่วงหน้า">
                <span className="w-2 h-2 rounded-full bg-orange-500" />
              </Link>
              <Link href="/master-logic/saw-machine"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/saw-machine' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas SKU ใช้เครื่องเลื่อย">
                <span className="w-2 h-2 rounded-full bg-teal-400" />
              </Link>
              <Link href="/master-logic/phlit-tor-kan"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/phlit-tor-kan' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas ผลิตต่อกัน">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
              </Link>
              <Link href="/master-logic/special-raw"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/special-raw' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="Mas Special Raw">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
              </Link>
              <Link href="/master-logic/bom-special"
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === '/master-logic/bom-special' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title="BOM พิเศษ">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
              </Link>
            </div>
          )}

          <p className={sectionCls}>Admin</p>
          <div className={dividerCls} />
          <NavLink href="/admin/production-plan" allowed={has('11')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/admin/production-plan', has('11'))}`}
            title="จัดการแผนผลิต">
            <ShieldAlert size={18} className="shrink-0" />
            <span className={labelCls}>จัดการแผนผลิต</span>
          </NavLink>
          <NavLink href="/admin/users" allowed={has('12')}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${linkCls('/admin/users', has('12'))}`}
            title="User ระบบผลิต">
            <Users size={18} className="shrink-0" />
            <span className={labelCls}>User ระบบผลิต</span>
          </NavLink>
          <Link href="/admin/manual"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p === '/admin/manual' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}
            title="คู่มือการใช้งาน">
            <BookOpen size={18} className="shrink-0" />
            <span className={labelCls}>คู่มือการใช้งาน</span>
          </Link>

          </div>

        </nav>

        <div className="border-t border-gray-700 px-2 py-3 space-y-1">
          {user && (
            <div className={`px-3 py-2 ${collapsed ? 'md:hidden' : ''}`}>
              <p className="text-xs font-semibold text-white truncate">{user.username}</p>
              <p className="text-xs text-gray-400 truncate">{user.position}</p>
            </div>
          )}
          <Link href="/"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors ${collapsed ? 'md:justify-center' : ''}`}
            title="กลับหน้าหลัก">
            <ArrowLeft size={18} className="shrink-0" />
            <span className={labelCls}>กลับหน้าหลัก</span>
          </Link>
          {user && (
            <button
              onClick={handleLogout}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-red-900 hover:text-red-300 transition-colors ${collapsed ? 'md:justify-center' : ''}`}
              title="ออกจากระบบ"
            >
              <LogOut size={18} className="shrink-0" />
              <span className={labelCls}>ออกจากระบบ</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
