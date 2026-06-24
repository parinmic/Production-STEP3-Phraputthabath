'use client'
import { Slice } from 'lucide-react'

export default function BreaklinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-gray-400">
      <Slice size={48} strokeWidth={1.5} />
      <p className="text-lg font-semibold">Breakline</p>
      <p className="text-sm">หน้านี้อยู่ระหว่างการพัฒนา</p>
    </div>
  )
}
