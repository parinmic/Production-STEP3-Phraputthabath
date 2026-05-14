import { supabase } from '@/lib/supabase'
import { Users, ShoppingCart } from 'lucide-react'
import Link from 'next/link'

async function getStats() {
  const today = new Date().toISOString().split('T')[0]
  const [w, m] = await Promise.all([
    supabase.from('daily_workforce').select('id', { count: 'exact' }).eq('work_date', today),
    supabase.from('makro_orders').select('id', { count: 'exact' }),
  ])
  return { workforce: w.count ?? 0, makro: m.count ?? 0 }
}

export default async function DashboardPage() {
  const stats = await getStats()
  const cards = [
    { label: 'พนักงานวันนี้',   value: stats.workforce, unit: 'คน',     icon: Users,       color: 'bg-blue-500',   href: '/workforce' },
    { label: 'คำสั่งซื้อ Makro', value: stats.makro,    unit: 'รายการ', icon: ShoppingCart, color: 'bg-orange-500', href: '/makro' },
  ]
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">ภาพรวมระบบ</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-500">{c.label}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{c.value}</p>
                <p className="text-sm text-gray-400">{c.unit}</p>
              </div>
              <div className={c.color + ' p-3 rounded-xl'}>
                <c.icon className="text-white" size={22} />
              </div>
            </div>
          </Link>
        ))}
      </div>
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">คำสั่งผลิตแยกตามโต้ะ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: ' Station สามชั้น', slug: 'sam-chan', cls: 'border-blue-500 bg-blue-50 text-blue-700' },
            { label: 'Station สะโพก',   slug: 'sa-phok', cls: 'border-orange-500 bg-orange-50 text-orange-700' },
            { label: 'Station ไหล่',    slug: 'lai',     cls: 'border-green-500 bg-green-50 text-green-700' },
          ].map((t) => (
            <Link key={t.slug} href={`/production/${t.slug}`}
              className={`border-2 ${t.cls} rounded-xl p-5 font-semibold text-center hover:opacity-80`}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
