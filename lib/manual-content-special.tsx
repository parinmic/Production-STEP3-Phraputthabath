import {
  LayoutDashboard, BarChart3, PackageOpen, ClipboardList, Scissors, CalendarDays, Layers,
  AlertTriangle, Beef, Users, ShoppingCart, Leaf, Store, Slice, FileSpreadsheet, CalendarPlus,
  Package, TrendingUp, UserCog, Calculator, ShieldAlert,
} from 'lucide-react'
import type { ManualGroup, ManualOverview } from '@/components/ManualLayout'

export const specialOverview: ManualOverview = {
  description: 'ระบบฝั่งพิเศษ (STEP 3) ต้องมีข้อมูลตั้งต้นให้ครบก่อน ถึงจะใช้หน้าอื่นๆ ได้เต็มที่ ทำตามลำดับนี้ในการใช้งานครั้งแรกของแต่ละวัน',
  steps: [
    {
      title: 'Master Logic',
      description: 'อัพโหลดกำลังคน (Master กำลังคน) และ Master Calculation ทุกประเภท (Productivity, BOM, หน่วยหยิบ ฯลฯ) ให้ครบก่อน',
      hint: 'Master Logic การสร้างแผนผลิต',
    },
    {
      title: 'คำสั่งซื้อ + สต็อก',
      description: 'อัพโหลดคำสั่งซื้อ Makro/LOTUS/Wet Market/FS, แผนผลิต 100%, แผนรอบเสริม และ Stock Raw Material ของวันนั้น',
      hint: 'อัพโหลดข้อมูล',
    },
    {
      title: 'กำลังคน',
      description: 'ตรวจสอบว่าข้อมูลกำลังคนของวันนั้น sync เข้ามาแล้ว และปรับสถานะพนักงาน (ลา/ขาด) ให้ตรงกับความเป็นจริง',
      hint: 'ตรวจสอบสถานะกำลังคน',
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
    'แผน Phase 1 ของทุกวันจะถูกสร้างอัตโนมัติทุกเวลา 07:30 หลัง sync ข้อมูลกำลังคน — ไม่จำเป็นต้องกดสร้างเองถ้าไม่ได้แก้ไขข้อมูลอะไรเพิ่ม',
    'ปุ่ม/เมนูที่เห็นเป็นสีจางกดไม่ได้ หมายถึงบัญชีผู้ใช้ของคุณไม่มีสิทธิ์เข้าหน้านั้น ติดต่อ Admin เพื่อขอสิทธิ์เพิ่มที่หน้า "User ระบบผลิต"',
  ],
}

// Master Logic upload pages get an extra caption clarifying the table shown
// is example data (captured by loading a sample file into the preview —
// nothing was ever submitted/saved), not real employee/production data.
const MASTER_LOGIC_KEYS = ['manpower', 'calculation']

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
          'Phase 1 (รอบเช้า 08:30) — /withdrawal/1',
          'Phase 2 (รอบบ่าย 14:30) — /withdrawal/2',
          'Phase 3 (แผน 100% 16:30) — /withdrawal/3',
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
          'Station สามชั้น — /production/sam-chan',
          'Station สะโพก — /production/sa-phok',
          'Station ไหล่ — /production/lai',
          'Station หมูบด — /production/moo-chod',
          'Station สไลด์ — /production/slide',
          'Station เผาขา — /production/pao-kha',
          'Station เลาะขา — /production/loa-kha',
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
        summary: 'ตรวจสอบและปรับสถานะพนักงานรายวัน (ทำงาน/ลา/ขาด) แยกตาม Station และกะ',
        body: [
          'แสดงสถานะพนักงานแยกตาม Station พิเศษทั้ง 7 และตามกะ (กะ 1 / กะ 2) ของวันที่เลือก',
          'เลือกวันที่และ Station แล้วค้นหาชื่อพนักงาน คลิกเปลี่ยนสถานะ (ทำงาน/วันหยุด/ลาป่วย/ลากิจ/ลาพักร้อน) ผ่านป๊อปอัพได้ — สถานะที่ปรับจะบันทึกทับแผนที่ sync มา',
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
        bullets: ['Phase 1 — /shortage/1', 'Phase 2 — /shortage/2', 'Phase 3 — /shortage/3'],
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
        key: 'workforce',
        label: 'กำลังคนประจำวัน',
        href: '/workforce',
        icon: Users,
        summary: 'ดูข้อมูลสแกนเข้างานจริง และอัพโหลดแผนเข้างานประจำสัปดาห์',
        body: [
          '"อัพโหลดกำลังคนประจำวัน" (/workforce) แสดงข้อมูลสแกนเข้างานจริง (มา/มาสาย/ขาด) เทียบกับแผนที่วางไว้ แยกตาม Station/กะ/สถานะ — เลือกวันที่ ดูสรุปจำนวนคน แก้ไขข้อมูลรายบุคคลได้ และกดปุ่มซิงค์จากระบบสแกนนิ้วภายนอกได้',
          '"แผนเข้างานประจำสัปดาห์" (/workforce/weekly) ใช้อัพโหลดไฟล์รายชื่อ+ตารางวันหยุดของพนักงาน — เลือกไฟล์ ระบบพรีวิว 5 แถวแรกก่อนยืนยัน มีประวัติไฟล์ที่เคยอัพโหลดให้ดาวน์โหลด/ลบย้อนหลังได้',
        ],
      },
      {
        key: 'makro',
        label: 'คำสั่งซื้อ Makro',
        href: '/makro',
        icon: ShoppingCart,
        summary: 'อัพโหลดไฟล์ CSV คำสั่งซื้อช่องทาง Makro แบ่ง 2 รอบ',
        body: [
          'รอบ 8:00 น. (พาร์สแบบ Lotus/Wet Market) และรอบ 14:00 น. (พาร์สอัตโนมัติ ใช้ได้ทั้งคำสั่งซื้อปกติหรือไฟล์แผนผลิต Makro 100%)',
          'เลือกไฟล์ ดูพรีวิว แล้วกดอัพโหลดในแต่ละช่องของตนเอง',
        ],
      },
      {
        key: 'lotus',
        label: 'คำสั่งซื้อ LOTUS',
        href: '/lotus',
        icon: Leaf,
        summary: 'อัพโหลดไฟล์ CSV คำสั่งซื้อช่องทาง LOTUS แบ่ง 2 รอบ',
        body: ['รอบ 14:00 น. (คำสั่งซื้อรอบบ่าย) และรอบ 16:00 น. (ข้อมูลย้อนหลัง 3 วัน/BL3 สำหรับคำนวณ Phase 1) — เลือกไฟล์และอัพโหลดแยกตามรอบ'],
      },
      {
        key: 'wet-market',
        label: 'คำสั่งซื้อ Wet Market',
        href: '/wet-market',
        icon: Store,
        summary: 'อัพโหลดไฟล์ CSV คำสั่งซื้อช่องทาง Wet Market โครงสร้างเดียวกับ LOTUS',
        body: ['รอบ 14:00 น. (คำสั่งซื้อรอบบ่าย) และรอบ 16:00 น. (ข้อมูลย้อนหลัง 3 วันสำหรับคำนวณ Phase 1)'],
      },
      {
        key: 'fs',
        label: 'คำสั่งซื้อ FS',
        href: '/fs',
        icon: Slice,
        summary: 'อัพโหลดไฟล์คำสั่งซื้อช่องทาง Food Service เป็นไฟล์รอบเดียวต่อวัน',
        body: ['หลังอัพโหลด ระบบจะแบ่งจัดสรรลง Phase ให้อัตโนมัติ'],
      },
      {
        key: 'plan-100',
        label: 'แผนผลิต 100%',
        href: '/plan-100',
        icon: FileSpreadsheet,
        summary: 'อัพโหลดไฟล์ Template แผนผลิต ใช้เป็นฐานคำนวณ Phase 3',
        body: ['ระบบอ่านชีท "แผน 100%" ในไฟล์ — Phase 3 คำนวณจาก แผน 100% ลบ Phase 1 ลบ Phase 2 เลือกไฟล์และอัพโหลดเพียงจุดเดียว'],
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
        key: 'manpower',
        label: 'กำลังคน (Master Logic)',
        href: '/master-logic/manpower/sa-phok-special',
        icon: UserCog,
        summary: 'อัพโหลด Master Logic กำลังคน (อัตรากำลังคนมาตรฐาน) ต่อกลุ่มผลิตภัณฑ์พิเศษ',
        body: ['เป็นฟอร์มอัพโหลดไฟล์แบบเดียว มีประวัติไฟล์ที่เคยอัพโหลด — ใช้รูปแบบเดียวกันทุกประเภท ต่างกันแค่ข้อมูล'],
        bullets: [
          'สะโพกพิเศษ, ไหล่พิเศษ, สามชั้นพิเศษ, หมูบดพิเศษ, สไลด์พิเศษ, เผาขาพิเศษ, เลาะขาพิเศษ',
        ],
      },
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
          'BOM สินค้า (/bom) — เชื่อม SAP สินค้ากับวัตถุดิบและ % Yield',
          'Mas หน่วยหยิบสินค้า (/picking-unit) — แปลงน้ำหนัก (กก.) เป็นจำนวนถุงต่อ SKU',
          'Mas SKU ไม่ต้องเบิก (/no-withdrawal) — SKU ที่มีแผนผลิตแต่ไม่ต้องออกใบเบิก',
          'Mas หมูบด %ไขมัน (/master-logic/moo-chod) — สัดส่วนเนื้อ:มันที่ต้องผสม',
          'Mas เบิกหมูบด (/master-logic/moo-chod-withdrawal) — ลำดับเบิกวัตถุดิบหมูบด',
          'Mas Priority เบิก RM (/master-logic/priority-withdrawal) — ลำดับความสำคัญเบิกวัตถุดิบ',
          'Mas ผลิต Raw ล่วงหน้า (/master-logic/raw-advance) — ปริมาณ Raw ที่ต้องผลิตล่วงหน้า',
          'Mas SKU ใช้เครื่องเลื่อย (/master-logic/saw-machine) — ฐานคำนวณของหน้าแผนเครื่องเลื่อย',
          'Mas ผลิตต่อกัน (/master-logic/phlit-tor-kan) — สินค้า WIP ที่ผลิตต่อเนื่องกัน',
          'Mas Special Raw (/master-logic/special-raw) — ตำแหน่ง Lot ที่ดึงมาใช้ก่อน FIFO ปกติ',
          'BOM พิเศษ (/master-logic/bom-special) — BOM เฉพาะกลุ่มสินค้าพิเศษ',
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
        summary: 'แก้ไขแผนผลิตราย SKU โดยตรง',
        body: [
          'เลือกวันที่และ Phase แล้วดูตารางยอดผลิตแยกตาม Channel/Station/SKU',
          'แก้ไขยอด (target quantity) ของแต่ละ SKU, เพิ่ม SKU ใหม่เข้าแผน, หรือลบข้อมูลทั้ง Phase ได้',
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
