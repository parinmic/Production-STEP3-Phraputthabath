import Link from 'next/link'
import { Factory } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-10 px-6">
      <div className="flex items-center gap-3 text-white">
        <Factory size={40} className="text-blue-400" />
        <div>
          <p className="text-2xl font-bold">PPTB Production</p>
          <p className="text-gray-400 text-sm">เลือกโหมดการใช้งาน</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-5 w-full max-w-md">
        <Link
          href="/basic"
          className="flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-gray-600 bg-gray-800 text-white py-10 px-8 text-xl font-semibold hover:bg-gray-700 hover:border-gray-500 transition-colors"
        >
          <span className="text-4xl">📋</span>
          เบสิค
        </Link>

        <Link
          href="/home"
          className="flex-1 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-blue-500 bg-blue-600 text-white py-10 px-8 text-xl font-semibold hover:bg-blue-500 transition-colors"
        >
          <span className="text-4xl">⚙️</span>
          พิเศษ
        </Link>
      </div>
    </div>
  )
}
