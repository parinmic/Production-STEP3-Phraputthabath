import {
  LayoutDashboard, BarChart3, PackageOpen, ClipboardList, Scissors, Layers, CalendarDays,
  AlertTriangle, Beef, Users, CalendarPlus,
  Package, TrendingUp, Calculator, ShieldAlert,
} from 'lucide-react'
import type { ManualGroup, ManualOverview } from '@/components/ManualLayout'

export const specialOverview: ManualOverview = {
  description: 'ระบบฝั่งพิเศษ (STEP 3) ต้องมีข้อมูลตั้งต้นให้ครบก่อน ถึงจะใช้หน้าอื่นๆ ได้เต็มที่ ทำตามลำดับนี้ในการใช้งานครั้งแรกของแต่ละวัน',
  steps: [
    {
      title: 'Master Logic',
      description: 'อัพโหลด Master Calculation ทุกประเภท (Productivity, BOM, หน่วยหยิบ ฯลฯ) ให้ครบก่อน',
      hint: 'Master Logic การสร้างแผนผลิต',
    },
    {
      title: 'คำสั่งซื้อ + สต็อก',
      description: 'อัพโหลดคำสั่งซื้อ Makro/LOTUS/Wet Market/FS, แผนผลิต 100%, แผนรอบเสริม และ Stock Raw Material ของวันนั้น',
      hint: 'อัพโหลดข้อมูล',
    },
    {
      title: 'กำลังคน',
      description: 'ระบบดึงข้อมูลกำลังคนจากภายนอกและสร้างแผน Phase 1 ให้อัตโนมัติทุกวัน 08:05 ไม่ต้องทำอะไรเพิ่ม ถ้าข้อมูลยังไม่มาหรือแผนไม่ขึ้น ใช้ปุ่ม "สร้างแผนฉุกเฉิน" ที่หน้า Admin — จัดการแผนผลิต แทนได้',
      hint: 'จัดการแผนผลิต',
    },
    {
      title: 'สร้างคำสั่งผลิต',
      description: 'ไปหน้าคำสั่งผลิตราย Station แล้วกดสร้างคำสั่งผลิตแต่ละ Phase ระบบจะจัดสรรงานให้พนักงานอัตโนมัติ',
      hint: 'คำสั่งผลิตราย Station',
    },
    {
      title: 'ดูผลลัพธ์',
      description: 'ดูรายการเบิกสินค้า/พิมพ์ใบเบิก, รายการ Raw รอผลิต, จัดสรรเนื้อ Raw Mat, แผนเครื่องเลื่อย และ Dashboard บริหาร',
      hint: 'รายการเบิกสินค้า',
    },
  ],
  notes: [
    'แผน Phase 1 ของทุกวันจะถูกสร้างอัตโนมัติทุกเวลา 08:05 หลัง sync ข้อมูลกำลังคน — ไม่จำเป็นต้องกดสร้างเองถ้าไม่ได้แก้ไขข้อมูลอะไรเพิ่ม',
    'ปุ่ม/เมนูที่เห็นเป็นสีจางกดไม่ได้ หมายถึงบัญชีผู้ใช้ของคุณไม่มีสิทธิ์เข้าหน้านั้น ติดต่อ Admin เพื่อขอสิทธิ์เพิ่มที่หน้า "User ระบบผลิต"',
  ],
}

// Master Logic upload pages get an extra caption clarifying the table shown
// is example data (captured by loading a sample file into the preview —
// nothing was ever submitted/saved), not real employee/production data.
const MASTER_LOGIC_KEYS = ['calculation']

const RAW_SPECIAL_GROUPS: ManualGroup[] = [
  {
    heading: 'หน้าหลัก',
    items: [
      {
        key: 'home',
        label: 'ภาพรวม',
        href: '/home',
        icon: LayoutDashboard,
        summary: 'หน้าแรกของฝั่งพิเศษ แสดงปุ่มลัดไปยังคำสั่งผลิตแต่ละ Station',
        body: [
          'หน้าแรกที่เจอเมื่อเข้าระบบฝั่งพิเศษ แสดงการ์ดลัดไปยัง "คำสั่งผลิตแยกตามโต๊ะ" ทั้ง 7 Station',
          'คลิกที่การ์ด Station เพื่อไปหน้าคำสั่งผลิตของ Station นั้นโดยตรง',
        ],
        bullets: [
          'Station ที่มี: สามชั้น, สะโพก, ไหล่, หมูบด, สไลด์, เผาขา, เลาะขา',
          'การ์ดที่ไม่มีสิทธิ์เข้าถึงจะแสดงจางและกดไม่ได้',
        ],
      },
      {
        key: 'executive-dashboard',
        label: 'Dashboard บริหาร',
        href: '/executive-dashboard',
        icon: BarChart3,
        summary: 'แดชบอร์ดสรุปภาพรวมการผลิตรายวันระดับบริหาร',
        body: [
          'แสดงตารางสรุป Order เทียบกับ Baseline เฉลี่ย 3 วันย้อนหลัง, ยอดผลิต Phase 1-3, ยอดผลิตรวม และรับผลได้ (yield) ต่อ SKU',
          'เลือกวันที่และกรองตาม Station ที่ต้องการดู แล้วกดดาวน์โหลดข้อมูลเป็นไฟล์ Excel ได้',
        ],
      },
    ],
  },
  {
    heading: 'คำสั่งเบิกและผลิต',
    items: [
      {
        key: 'withdrawal',
        label: 'รายการเบิกสินค้า',
        href: '/withdrawal/1',
        icon: PackageOpen,
        summary: 'รายการวัตถุดิบที่ต้องเบิกในแต่ละรอบ คำนวณจากคำสั่งผลิตอัตโนมัติ',
        body: [
          'ระบบคำนวณวัตถุดิบที่ต้องเบิกจากคำสั่งผลิตที่สร้างไว้ แสดงเป็นรายการต่อ Station พร้อมล็อตที่ต้องเบิกและปลายทางที่ใช้',
          'เลือกวันที่แล้วดูรายการของแต่ละรอบ จากนั้นพิมพ์/ดาวน์โหลดใบเบิกเป็น PDF ได้',
        ],
        bullets: [
          'Phase 1 (รอบเช้า 08:30)',
          'Phase 2 (รอบบ่าย 14:30)',
          'Phase 3 (แผน 100% 16:30)',
        ],
      },
      {
        key: 'production',
        label: 'คำสั่งผลิตราย Station',
        href: '/production/sam-chan',
        icon: ClipboardList,
        summary: 'หน้ามอบหมายงานผลิตให้พนักงานรายบุคคลของแต่ละ Station',
        body: [
          'แสดงคำสั่งผลิต/มอบหมายงานให้พนักงานแต่ละคนของ Station นั้น แบ่งตาม Phase 1-3 (หรือดูรวมทั้งหมด)',
          'กดปุ่ม "สร้างคำสั่งผลิต" เพื่อให้ระบบ generate มอบหมายงานให้พนักงาน (เลือกโหมดหักลบยอดจากเป้าหมายได้) แล้วดูตารางงานพร้อมเวลาที่คาดว่าจะเสร็จของแต่ละคน',
          'ทุก Station ใช้หน้ารูปแบบเดียวกัน ต่างกันแค่ข้อมูล',
        ],
        bullets: [
          'Station สามชั้น',
          'Station สะโพก',
          'Station ไหล่',
          'Station หมูบด',
          'Station สไลด์',
          'Station เผาขา',
          'Station เลาะขา',
          'สามารถ export/พิมพ์ตารางงานได้',
        ],
      },
      {
        key: 'saw-machine-plan',
        label: 'แผนการใช้เครื่องเลื่อย',
        href: '/saw-machine-plan',
        icon: Scissors,
        summary: 'ตารางเวลาการใช้เครื่องเลื่อยแยกตาม Phase',
        body: [
          'คำนวณระยะเวลาใช้เครื่องเลื่อยจากปริมาณวัตถุดิบที่เบิกจริง หารด้วยกำลังการผลิต (กก./ชม.) ของแต่ละ Station แยกตาม Phase (เช้า/บ่าย/ค่ำ)',
          'เลือกวันที่ดูตาราง แล้วกดปุ่ม "ปรับแผน" เพื่อให้ระบบเสนอการจัดลำดับ/ปรับตารางใหม่ จากนั้นยืนยันบันทึก',
        ],
      },
      {
        key: 'workforce-daily-status',
        label: 'ตรวจสอบสถานะกำลังคน',
        href: '/workforce-daily-status',
        icon: CalendarDays,
        summary: 'ดูรายชื่อ/สถานีของพนักงานที่ทำงานวันนั้น (ดูอย่างเดียว)',
        body: [
          'ดึงข้อมูลจาก Sync กำลังคนอัตโนมัติทุกวัน 08:05 — เลือกวันที่ ดูรายชื่อพนักงานแยกตาม Station/กะ ค้นหาชื่อได้',
          'หน้านี้ดูอย่างเดียว ไม่มีการแก้ไขสถานะพนักงานแล้ว (เดิมเคยแก้ไขได้ ตอนนี้ข้อมูลมาจาก Sync ล้วนๆ)',
        ],
      },
      {
        key: 'wip-plan',
        label: 'แผนผลิต WIP',
        href: '/wip-plan',
        icon: Layers,
        summary: 'แผนผลิตสินค้ากลุ่ม WIP (สินค้ากึ่งสำเร็จรูปที่เป็นวัตถุดิบของสินค้าอื่น)',
        body: [
          'ระบบคำนวณค่าเฉลี่ยความต้องการย้อนหลัง 7 วันจาก Stock/ยอดสั่งซื้อ/แผน 100% ให้อัตโนมัติ',
          'เลือกวันที่ แล้วปรับตัวเลขจำนวนที่จะผลิตเพิ่ม/ลดจากค่าที่คำนวณให้ จากนั้นกดบันทึก',
        ],
      },
      {
        key: 'shortage',
        label: 'รายการ Raw รอผลิต',
        href: '/shortage/1',
        icon: AlertTriangle,
        summary: 'รายการวัตถุดิบที่ขาดหรือค้างผลิตไม่ทันในแต่ละ Phase',
        body: [
          'ดึงจากงานมอบหมายที่ติด flag "ขาด" (deficit) แล้วแปลงจากปริมาณสินค้าสำเร็จรูปเป็นปริมาณวัตถุดิบผ่าน BOM',
          'เลือกวันที่ดูรายการวัตถุดิบขาด/ที่รอผลิตต่อ Station และ export ข้อมูลได้',
        ],
        bullets: ['Phase 1', 'Phase 2', 'Phase 3'],
      },
      {
        key: 'rm-allocation',
        label: 'จัดสรรเนื้อ Raw Mat',
        href: '/withdrawal/rm-allocation',
        icon: Beef,
        summary: 'การจัดสรรวัตถุดิบเนื้อให้แต่ละกลุ่มงาน/Station ตามลำดับความสำคัญ',
        body: [
          'เทียบปริมาณที่ต้องการ (needed) กับที่จัดสรรได้ (allocated) และส่วนที่ขาด (shortage) เป็นกราฟแท่ง % แยกตามลำดับความสำคัญ (Priority P1-P4)',
          'เลือกวันที่ดูผลจัดสรรต่อ Phase และสามารถบันทึก snapshot ของผลจัดสรรแต่ละ Phase ได้',
        ],
      },
    ],
  },
  {
    heading: 'อัพโหลดข้อมูล',
    items: [
      {
        key: 'upload-overview',
        label: 'อัพโหลดคำสั่งซื้อ',
        href: '/upload-overview',
        icon: Layers,
        summary: 'รวมหน้าอัพโหลดคำสั่งซื้อ Makro/LOTUS/Wet Market/FS และแผนผลิต 100% ไว้หน้าเดียว เป็นตารางช่องทาง × รอบเวลา',
        body: [
          'แต่ละแถวคือช่องทาง (Makro, LOTUS, Wet Market, FS) แต่ละคอลัมน์คือรอบเวลา (8:00, 14:00, 16:00, แผน 100%) — ช่องที่ไม่ต้องใช้จะทึบเทาไว้ คลิกช่องว่างเพื่อเลือกไฟล์ ดูพรีวิว แล้วกดยืนยันอัพโหลด',
          'ปุ่ม "สร้าง Phase 1/2/3" อยู่เหนือคอลัมน์รอบที่ตรงกัน กดเพื่อสั่งสร้างแผนผลิตจากไฟล์ที่อัพโหลดของวันที่เลือกได้ทันที (Phase 2/3 มีให้เลือกยอดที่ใช้หักลบจากเป้าหมาย)',
          'กดปุ่ม "แก้ไข" เพื่อเปิดโหมดลบไฟล์ที่อัพโหลดไปแล้วในแต่ละช่อง ส่วนด้านล่างมีตารางประวัติการอัพโหลดทั้งหมด กรองตามช่องทาง/รอบได้',
        ],
        bullets: [
          'Makro — รอบ 8:00 น. และ 14:00 น. (รอบ 14:00 พาร์สอัตโนมัติ ใช้ได้ทั้งคำสั่งซื้อปกติหรือไฟล์แผนผลิต Makro 100%)',
          'LOTUS / Wet Market — รอบ 14:00 น. (คำสั่งซื้อรอบบ่าย), รอบ 16:00 น. (ข้อมูลย้อนหลังสำหรับคำนวณ Phase 1) และแผน 100%',
          'ช่อง "แผน 100%" ของ LOTUS กับ Wet Market ใช้ไฟล์เดียวกัน ระบบจึงรวมเป็นกล่องเดียวคร่อม 2 แถว',
          'FS — รอบ 16:00 น. เท่านั้น หลังอัพโหลดระบบแบ่งจัดสรรลง Phase ให้อัตโนมัติ',
        ],
      },
      {
        key: 'supplementary-plan',
        label: 'แผนรอบเสริม',
        href: '/supplementary-plan',
        icon: CalendarPlus,
        summary: 'อัพโหลดไฟล์ Excel ชีท "แผนรอบเสริม" ระบบกำหนด slot ให้อัตโนมัติ',
        body: [
          'อ่านเวลาที่โหลดจากช่อง D1, วันที่ผลิตจาก H2, รายการสินค้าจากคอลัมน์ D (SAP) และ H (น้ำหนักสั่ง)',
          'slot กำหนดจากเวลาที่โหลด: ≤14:00 = slot 1, ≤16:00 = slot 2, อื่นๆ = slot 3',
        ],
      },
      {
        key: 'stock-raw-material',
        label: 'Stock Raw Material',
        href: '/stock-raw-material',
        icon: Package,
        summary: 'อัพโหลดข้อมูลสต๊อกวัตถุดิบ 3 ไฟล์แยกกัน',
        body: ['ต้องอัพโหลด STOCK 0010, Stock คลัง 20 และ Stock คลัง 100 — แต่ละช่องมีปุ่มอัพโหลดและประวัติของตัวเอง'],
      },
      {
        key: 'yield',
        label: 'รับผลได้',
        href: '/yield',
        icon: TrendingUp,
        summary: 'อัพโหลดไฟล์ Excel ผลการผลิตจริง (yield)',
        body: [
          'ระบบกรองเฉพาะแถวที่คอลัมน์ C เป็นรหัส 168, 169M หรือ 224M แล้วรวมยอดถุง (คอลัมน์ J) และน้ำหนัก (คอลัมน์ K) ต่อ SAP',
          'เลือกวันที่ทำงาน อัพโหลดไฟล์ ดูผลรวมที่พาร์สได้ แล้วยืนยันบันทึกเข้าระบบ',
        ],
      },
    ],
  },
  {
    heading: 'Master Logic การสร้างแผนผลิต',
    items: [
      {
        key: 'calculation',
        label: 'Master Calculation',
        href: '/master-logic/calculation/mas-productivity',
        icon: Calculator,
        summary: 'อัพโหลดไฟล์ตั้งค่า Master Calculation แต่ละประเภท (ค่าคงที่/เกณฑ์ที่ใช้คำนวณแผนผลิต)',
        body: [
          'แต่ละประเภทเป็นฟอร์มอัพโหลดไฟล์แบบเดียวพร้อมประวัติการอัพโหลด',
          '9 ประเภทหลัก: Mas Productivity, Mas %Variance Makro/Wet Market/LOTUS, Mas LOTUS, Mas Channel, Mas ตระกร้า, Mas Special, Mas Sku ผลิตพร้อมกัน',
        ],
        bullets: [
          'BOM สินค้า — เชื่อม SAP สินค้ากับวัตถุดิบและ % Yield',
          'Mas หน่วยหยิบสินค้า — แปลงน้ำหนัก (กก.) เป็นจำนวนถุงต่อ SKU',
          'Mas SKU ไม่ต้องเบิก — SKU ที่มีแผนผลิตแต่ไม่ต้องออกใบเบิก',
          'Mas หมูบด %ไขมัน — สัดส่วนเนื้อ:มันที่ต้องผสม',
          'Mas เบิกหมูบด — ลำดับเบิกวัตถุดิบหมูบด',
          'Mas Priority เบิก RM — ลำดับความสำคัญเบิกวัตถุดิบ',
          'Mas ผลิต Raw ล่วงหน้า — ปริมาณ Raw ที่ต้องผลิตล่วงหน้า',
          'Mas SKU ใช้เครื่องเลื่อย — ฐานคำนวณของหน้าแผนเครื่องเลื่อย',
          'Mas ผลิตต่อกัน — สินค้า WIP ที่ผลิตต่อเนื่องกัน',
          'Mas Special Raw — ตำแหน่ง Lot ที่ดึงมาใช้ก่อน FIFO ปกติ',
          'BOM พิเศษ — BOM เฉพาะกลุ่มสินค้าพิเศษ',
        ],
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      {
        key: 'admin-production-plan',
        label: 'จัดการแผนผลิต',
        href: '/admin/production-plan',
        icon: ShieldAlert,
        summary: 'แก้ไขแผนผลิตราย SKU โดยตรง และสร้างแผน Phase 1 แบบฉุกเฉิน',
        body: [
          'เลือกวันที่และ Phase แล้วดูตารางยอดผลิตแยกตาม Channel/Station/SKU',
          'แก้ไขยอด (target quantity) ของแต่ละ SKU, เพิ่ม SKU ใหม่เข้าแผน, หรือลบข้อมูลทั้ง Phase ได้',
          'ปุ่ม "สร้างแผนฉุกเฉิน (Phase 1)" ใช้เมื่อข้อมูลกำลังคนของวันนี้ยังไม่ sync เข้ามา (เช่น ยังไม่ถึง 08:05 หรือต้นทางข้อมูลยังไม่อัพเดท) — กดแล้วระบบจะสร้าง Phase 1 ทันทีโดยใช้ข้อมูลกำลังคนของวันก่อนหน้าล่าสุดแทน และเขียนทับแผน Phase 1 เดิมของวันนั้นทั้งหมด',
        ],
      },
      {
        key: 'admin-users',
        label: 'User ระบบผลิต',
        href: '/admin/users',
        icon: Users,
        summary: 'จัดการผู้ใช้งานระบบ สิทธิ์เมนู และ step การเข้าถึง',
        body: [
          'แสดงรายชื่อผู้ใช้พร้อมตำแหน่ง สิทธิ์เมนู (menus) และ step การเข้าถึง',
          'เพิ่มผู้ใช้ใหม่, เปลี่ยนรหัสผ่าน, เปิด/ปิดการใช้งาน, ลบผู้ใช้ และอัพโหลดไฟล์รายชื่อผู้ใช้เป็นชุด (bulk) พร้อมพรีวิวก่อนบันทึกได้',
        ],
      },
    ],
  },
]

export const specialManualGroups: ManualGroup[] = RAW_SPECIAL_GROUPS.map(g => ({
  ...g,
  items: g.items.map(i => ({
    ...i,
    image: `/manual-screenshots/special/${i.key}.jpg`,
    imageCaption: MASTER_LOGIC_KEYS.includes(i.key)
      ? 'ตัวอย่างข้อมูลหลังเลือกไฟล์ (ข้อมูลสมมติ ไม่ใช่ข้อมูลพนักงาน/การผลิตจริง)'
      : undefined,
  })),
}))
