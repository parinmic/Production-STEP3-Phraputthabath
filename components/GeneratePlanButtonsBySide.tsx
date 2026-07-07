'use client'
import { usePathname } from 'next/navigation'
import GenerateSpecialPlanButtons from '@/components/GenerateSpecialPlanButtons'
import GenerateBasicPlanButtons from '@/components/GenerateBasicPlanButtons'

// อัพโหลดคำสั่งซื้อ/แผน 100% เป็นหน้าที่ใช้ร่วมกันทั้ง Special (STEP 3) และ Basic (STEP 2)
// ปุ่มสร้างแผนต้องยิงคนละ API (generate vs generate-basic) ตาม step ที่กำลังเปิดอยู่
export default function GeneratePlanButtonsBySide({ menuKey }: { menuKey: string }) {
  const pathname = usePathname()
  return pathname?.startsWith('/basic')
    ? <GenerateBasicPlanButtons menuKey={menuKey} />
    : <GenerateSpecialPlanButtons menuKey={menuKey} />
}
