import Link from 'next/link'

export default function BasicHomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">ภาพรวม (เบสิค)</h1>
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">คำสั่งผลิตแยกตามโต้ะ</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: 'Station สะโพกเบสิค',  slug: 'sa-phok-basic',  cls: 'border-orange-500 bg-orange-50 text-orange-700' },
            { label: 'Station ไหล่เบสิค',   slug: 'lai-basic',      cls: 'border-green-500 bg-green-50 text-green-700' },
            { label: 'Station สามชั้นเบสิค', slug: 'sam-chan-basic', cls: 'border-blue-500 bg-blue-50 text-blue-700' },
          ].map((t) => (
            <Link key={t.slug} href={`/basic/production/${t.slug}`}
              className={`border-2 ${t.cls} rounded-xl p-5 font-semibold text-center hover:opacity-80`}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
