import Link from 'next/link'

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">ภาพรวม ตัดแต่งพิเศษ</h1>
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">คำสั่งผลิตแยกตามโต้ะ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: 'Station สามชั้น', slug: 'sam-chan',  cls: 'border-blue-500 bg-blue-50 text-blue-700' },
            { label: 'Station สะโพก',  slug: 'sa-phok',  cls: 'border-orange-500 bg-orange-50 text-orange-700' },
            { label: 'Station ไหล่',   slug: 'lai',      cls: 'border-green-500 bg-green-50 text-green-700' },
            { label: 'Station หมูบด',  slug: 'moo-chod', cls: 'border-red-500 bg-red-50 text-red-700' },
            { label: 'Station สไลด์',  slug: 'slide',    cls: 'border-purple-500 bg-purple-50 text-purple-700' },
            { label: 'Station เผาขา',  slug: 'pao-kha',  cls: 'border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700' },
            { label: 'Station เลาะขา', slug: 'loa-kha',  cls: 'border-teal-500 bg-teal-50 text-teal-700' },
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
