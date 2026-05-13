'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, ShoppingCart, BarChart3, ClipboardList, ChevronDown, ChevronRight, Factory, ChevronLeft, Package, UserCog, Calculator, PackageOpen, Layers, Store, Leaf, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'

const TABLES = [
  { label: 'Station สามชั้น', slug: 'sam-chan', dot: 'bg-blue-500' },
  { label: 'Station สะโพก',   slug: 'sa-phok', dot: 'bg-orange-500' },
  { label: 'Station ไหล่',    slug: 'lai',     dot: 'bg-green-500' },
]

const MANPOWER_TYPES = [
  { label: 'สะโพกพิเศษ',   slug: 'sa-phok-special', dot: 'bg-orange-500' },
  { label: 'ไหล่พิเศษ',    slug: 'lai-special',     dot: 'bg-green-500' },
  { label: 'สามชั้นพิเศษ', slug: 'sam-chan-special', dot: 'bg-blue-500' },
]

const CALCULATION_TYPES = [
  { label: 'Mas Productivity',       slug: 'mas-productivity',        dot: 'bg-purple-500' },
  { label: 'Mas %Variance Makro',    slug: 'mas-variance-makro',      dot: 'bg-blue-500' },
  { label: 'Mas %Variance Wet Market', slug: 'mas-variance-wet-market', dot: 'bg-cyan-500' },
  { label: 'Mas LOTUS',              slug: 'mas-lotus',               dot: 'bg-green-500' },
  { label: 'Mas Channel',            slug: 'mas-channel',             dot: 'bg-orange-500' },
]

export default function Sidebar() {
  const p = usePathname()
  const [open, setOpen] = useState(p.startsWith('/production'))
  const [openWithdrawal, setOpenWithdrawal] = useState(p.startsWith('/withdrawal'))
  const [openManpower, setOpenManpower] = useState(p.startsWith('/master-logic/manpower'))
  const [openCalculation, setOpenCalculation] = useState(p.startsWith('/master-logic/calculation'))
  const [collapsed, setCollapsed] = useState(false)
  const a = (href: string) => p === href ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} min-h-screen bg-gray-900 text-white flex flex-col transition-all duration-300 relative shrink-0`}>
      {/* Header */}
      <div className="px-3 py-5 border-b border-gray-700 flex items-center gap-3 overflow-hidden">
        <Factory className="text-blue-400 shrink-0" size={28} />
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="font-bold text-sm whitespace-nowrap">ระบบคำสั่งผลิต</p>
            <p className="text-gray-400 text-xs whitespace-nowrap">Production Management</p>
          </div>
        )}
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-6 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-full w-6 h-6 flex items-center justify-center z-10 transition-colors"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a('/')}`} title="ภาพรวม">
          <LayoutDashboard size={18} className="shrink-0" />
          {!collapsed && <span>ภาพรวม</span>}
        </Link>

        {!collapsed && <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3">คำสั่งเบิกและผลิต</p>}
        {collapsed && <div className="border-t border-gray-700 my-2" />}

        {/* รายการเบิกสินค้า */}
        <button
          onClick={() => setOpenWithdrawal(!openWithdrawal)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/withdrawal') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
          title="รายการเบิกสินค้า"
        >
          <PackageOpen size={18} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">รายการเบิกสินค้า</span>
              {openWithdrawal ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </>
          )}
        </button>

        {openWithdrawal && !collapsed && (
          <div className="ml-4 space-y-1">
            {[
              { label: 'Phase 1 (รอบเช้า)',    slug: '1', dot: 'bg-blue-500' },
              { label: 'Phase 2 (รอบบ่าย)',    slug: '2', dot: 'bg-orange-500' },
              { label: 'Phase 3 (แผน 100%)',     slug: '3', dot: 'bg-purple-500' },
            ].map((t) => (
              <Link key={t.slug} href={`/withdrawal/${t.slug}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/withdrawal/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
              </Link>
            ))}
          </div>
        )}

        {openWithdrawal && collapsed && (
          <div className="space-y-1">
            {['1','2','3'].map((phase, i) => (
              <Link key={phase} href={`/withdrawal/${phase}`}
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/withdrawal/${phase}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title={`Phase ${phase}`}>
                <span className={`text-xs font-bold`}>P{phase}</span>
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
          {!collapsed && (
            <>
              <span className="flex-1 text-left">คำสั่งผลิตราย Station</span>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </>
          )}
        </button>

        {open && !collapsed && (
          <div className="ml-4 space-y-1">
            {TABLES.map((t) => (
              <Link key={t.slug} href={`/production/${t.slug}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
              </Link>
            ))}
          </div>
        )}

        {open && collapsed && (
          <div className="space-y-1">
            {TABLES.map((t) => (
              <Link key={t.slug} href={`/production/${t.slug}`}
                className={`flex items-center justify-center px-2 py-2 rounded-lg transition-colors ${p === `/production/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                title={t.label}>
                <span className={`w-2 h-2 rounded-full ${t.dot}`} />
              </Link>
            ))}
          </div>
        )}

        {!collapsed && <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3">อัพโหลดข้อมูล</p>}
        {collapsed && <div className="border-t border-gray-700 my-2" />}

        {[
          { href: '/workforce',          icon: Users,        label: 'กำลังคนประจำวัน' },
          { href: '/makro',              icon: ShoppingCart,  label: 'คำสั่งซื้อ Makro' },
          { href: '/lotus',              icon: Leaf,          label: 'คำสั่งซื้อ LOTUS' },
          { href: '/wet-market',         icon: Store,         label: 'คำสั่งซื้อ Wet Market' },
          { href: '/quota',              icon: BarChart3,     label: 'Quota ช่องทางขาย' },
          { href: '/stock-raw-material', icon: Package,          label: 'Stock Raw Material' },
          { href: '/plan-100',           icon: FileSpreadsheet, label: 'แผนผลิต 100%' },
        ].map((m) => (
          <Link key={m.href} href={m.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${a(m.href)}`} title={m.label}>
            <m.icon size={18} className="shrink-0" />
            {!collapsed && <span>{m.label}</span>}
          </Link>
        ))}

        {!collapsed && <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider pt-3 pb-1 px-3">Master Logic การสร้างแผนผลิต</p>}
        {collapsed && <div className="border-t border-gray-700 my-2" />}

        {/* กำลังคน */}
        <button
          onClick={() => setOpenManpower(!openManpower)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${p.startsWith('/master-logic/manpower') ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
          title="กำลังคน"
        >
          <UserCog size={18} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">กำลังคน</span>
              {openManpower ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </>
          )}
        </button>

        {openManpower && !collapsed && (
          <div className="ml-4 space-y-1">
            {MANPOWER_TYPES.map((t) => (
              <Link key={t.slug} href={`/master-logic/manpower/${t.slug}`}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${p === `/master-logic/manpower/${t.slug}` ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />{t.label}
              </Link>
            ))}
          </div>
        )}

        {openManpower && collapsed && (
          <div className="space-y-1">
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
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Master Calculation</span>
              {openCalculation ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </>
          )}
        </button>

        {openCalculation && !collapsed && (
          <div className="ml-4 space-y-1">
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
          </div>
        )}

        {openCalculation && collapsed && (
          <div className="space-y-1">
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
          </div>
        )}
      </nav>

      {!collapsed && (
        <div className="px-6 py-4 border-t border-gray-700 text-gray-500 text-xs">CP Foods — Production System</div>
      )}
    </aside>
  )
}
