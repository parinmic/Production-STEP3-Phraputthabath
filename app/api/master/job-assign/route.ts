import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export interface JobAssignWorker {
  fullName: string                    // รายชื่อพนักงาน (normalized)
  nickname: string                    // ชื่อเล่น
  firstName: string                   // ชื่อจริง (no surname)
  station: string                     // จุดงาน
  isWeigher: boolean                  // ชั่งน้ำหนัก = 1
  groups: { name: string; level: number }[]  // 1 = ดีเยี่ยม, 2 = รองลงมา
}

const normName = (s: string) => s.replace(/\s+/g, ' ').trim()

// ชื่อไทยตัดเอาแค่คำแรก (ก่อนเว้นวรรค) ตัดนามสกุลออก — ชื่อ eng ล้วนเก็บทั้งหมด (ไม่มีนามสกุลปนในข้อมูลต้นทาง)
const firstNameOf = (fullName: string) =>
  /[฀-๿]/.test(fullName) ? (fullName.split(' ')[0] ?? fullName) : fullName

async function fromMasterLogic(): Promise<JobAssignWorker[]> {
  const { data, error } = await supabase
    .from('master_logic_manpower')
    .select('product_type, row_data')
  if (error) throw new Error(error.message)

  const workers: JobAssignWorker[] = []

  for (const row of data ?? []) {
    const r        = row.row_data as Record<string, unknown>
    const fullName = normName(String(r['รายชื่อพนักงาน'] ?? ''))
    if (!fullName) continue

    const nickname  = String(r['ชื่อเล่น'] ?? '').trim()
    const nameParts = fullName.split(' ')
    const firstName = nameParts[0] ?? fullName   // first word only (no surname)
    const station   = String(r['จุดงาน'] ?? '').trim()
    const isWeigher = Number(r['ชั่งน้ำหนัก'] ?? 0) === 1

    // Collect groups with skill level (1 = ดีเยี่ยม, 2 = รองลงมา)
    const groupMap = new Map<string, number>()
    for (const [key, val] of Object.entries(r)) {
      if (!key.startsWith('กลุ่ม')) continue
      if (val === null || val === undefined) continue
      const level    = Number(val)
      const cleanKey = key.replace(/_\d+$/, '')
      if (!groupMap.has(cleanKey) || level < (groupMap.get(cleanKey) ?? 99))
        groupMap.set(cleanKey, level)
    }
    const groups = Array.from(groupMap.entries()).map(([name, level]) => ({ name, level }))

    workers.push({ fullName, nickname, firstName, station, isWeigher, groups })
  }

  return workers
}

// ฝั่งพิเศษ (STEP 3) เลิกใช้ Master Logic กำลังคน แล้ว — ใช้ roster จาก employee_skills
// (sync จากภายนอกทุกวัน 08:05) แทน ไม่มี nickname ในข้อมูลนี้ จึงแสดงชื่อจริงไปก่อน
async function fromEmployeeSkills(): Promise<JobAssignWorker[]> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
  const { data, error } = await supabase
    .from('employee_skills')
    .select('name, work_station, is_weigher, skills')
    .eq('work_date', today)
  if (error) throw new Error(error.message)

  return (data ?? [])
    .map(r => {
      const fullName = normName(String(r.name ?? ''))
      const skills   = (r.skills ?? {}) as Record<string, number>
      return {
        fullName,
        nickname: '',
        firstName: firstNameOf(fullName),
        station: String(r.work_station ?? ''),
        isWeigher: Boolean(r.is_weigher),
        groups: Object.entries(skills).map(([name, level]) => ({ name, level: Number(level) })),
      }
    })
    .filter(w => w.fullName)
}

export async function GET(req: NextRequest) {
  try {
    const source  = req.nextUrl.searchParams.get('source')
    const workers = source === 'skills' ? await fromEmployeeSkills() : await fromMasterLogic()
    return NextResponse.json({ workers })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
