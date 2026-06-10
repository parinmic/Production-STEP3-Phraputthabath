import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-8 px-5 py-10">
      <div>
        <p className="text-base sm:text-lg font-bold text-gray-900 text-center">ระบบวางแผนผลิต</p>
        <p className="text-base sm:text-lg font-bold text-gray-900 text-center">โรงชำแหละสุกรพระพุทธบาท</p>
        <p className="text-gray-400 text-sm text-center mt-1">เลือกโหมดการใช้งาน</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm sm:max-w-md">
        <Link
          href="/basic"
          className="flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-sky-300 bg-sky-300 text-white py-8 sm:py-10 px-6 text-xl font-semibold active:opacity-80 hover:bg-sky-400 hover:border-sky-400 transition-colors shadow-sm"
        >
          เบสิค
          <span className="text-sm font-normal opacity-80">(STEP 2)</span>
        </Link>

        <Link
          href="/home"
          className="flex-1 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-blue-400 bg-blue-400 text-white py-8 sm:py-10 px-6 text-xl font-semibold active:opacity-80 hover:bg-blue-500 hover:border-blue-500 transition-colors shadow-sm"
        >
          พิเศษ
          <span className="text-sm font-normal opacity-80">(STEP 3)</span>
        </Link>
      </div>
    </div>
  )
}
