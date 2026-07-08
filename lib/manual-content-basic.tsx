import {
  LayoutDashboard, Thermometer, Package, AlertTriangle, ClipboardList, Slice,
  FlaskConical, Layers, Timer, Users, CalendarPlus,
  TrendingUp, Calculator, ShieldAlert, ClipboardCheck,
} from 'lucide-react'
import type { ManualGroup, ManualOverview } from '@/components/ManualLayout'

export const basicOverview: ManualOverview = {
  description: 'ระบบฝั่งเบสิค (STEP 2) ต้องมีข้อมูลตั้งต้นให้ครบก่อน ถึงจะใช้หน้าอื่นๆ ได้เต็มที่ ทำตามลำดับนี้ในการใช้งานครั้งแรกของแต่ละวัน',
  steps: [
    {
      title: 'Master Logic',
      description: 'อัพโหลด Master Calculation, BOM, Mas Yield และ Mas Temp QC ให้ครบก่อน',
      hint: 'Master Logic การสร้างแผนผลิต',
    },
    {
      title: 'คำสั่งซื้อ + สต็อก',
      description: 'อัพโหลดคำสั่งซื้อ Makro/LOTUS/Wet Market, แผนผลิต 100%, แผนรอบเสริม และ Stock Raw Material ของวันนั้น',
      hint: 'อัพโหลดข้อมูล',
    },
    {
      title: 'เบิกหมูซีก + QC',
      description: 'จัดลำดับ Lot ที่จะเบิกในหน้าเบิกหมูซีก และบันทึกผลตรวจอุณหภูมิหมูซีก/ชิ้นส่วน',
      hint: 'เบิกหมูซีก',
    },
    {
      title: 'สร้างคำสั่งผลิต',
      description: 'ไปหน้าคำสั่งผลิตราย Station แล้วกดสร้างแต่ละ Phase ระบบจะจัดสรรงานให้พนักงานอัตโนมัติ',
      hint: 'คำสั่งผลิตราย Station',
    },
    {
      title: 'ดูผลลัพธ์',
      description: 'ดูรายการ Raw รอผลิต, ตรวจสอบแผนผลิตกับ Admin, รายงานอุณหภูมิ และ Yield หมูซีก',
      hint: 'ตรวจสอบแผนผลิต',
    },
  ],
  notes: [
    'ปุ่ม/เมนูที่เห็นเป็นสีจางกดไม่ได้ หมายถึงบัญชีผู้ใช้ของคุณไม่มีสิทธิ์เข้าหน้านั้น ติดต่อ Admin เพื่อขอสิทธิ์เพิ่มที่หน้า "User ระบบผลิต"',
  ],
}

// Master Logic upload pages get an extra caption clarifying the table shown
// is example data (captured by loading a sample file into the preview —
// nothing was ever submitted/saved), not real employee/production data.
const MASTER_LOGIC_KEYS = ['calculation']

const RAW_BASIC_GROUPS: ManualGroup[] = [
  {
    heading: 'หน้าหลัก',
    items: [
      {
        key: 'home',
        label: 'ภาพรวม',
        href: '/basic',
        icon: LayoutDashboard,
        summary: 'หน้าแรกของฝั่งเบสิค แสดงการ์ดลัดไปยัง 3 Station การผลิต',
        body: ['คลิกการ์ด Station (สะโพก, ไหล่, สามชั้น) ที่ต้องการ เพื่อไปหน้าคำสั่งผลิตของ Station นั้นตามสิทธิ์ผู้ใช้'],
      },
    ],
  },
  {
    heading: 'คำสั่งเบิกและผลิต',
    items: [
      {
        key: 'temperature-check',
        label: 'ตรวจอุณหภูมิ (QC)',
        href: '/basic/temperature-check',
        icon: Thermometer,
        summary: 'บันทึกและดูรายงานผลตรวจอุณหภูมิหมูซีกและชิ้นส่วน',
        body: [
          '"อุณหภูมิหมูซีก" — บันทึกผลตรวจอุณหภูมิของแต่ละ Lot ที่รอผลิต แยกชุดต้น Lot/ชุดท้าย Lot และตัวที่ 1-3 กรอกค่าที่วัดได้ทีละช่อง ระบบคำนวณค่าเฉลี่ยและเทียบเกณฑ์สี (เขียว/เหลือง/แดง) ให้อัตโนมัติ',
          '"อุณหภูมิชิ้นส่วน" — ตรวจอุณหภูมิชิ้นส่วนที่ตัดแต่งแล้ว (สะโพก สันนอก สามชั้น ไหล่ สันคอ) เกณฑ์ผ่านคือ ≤ 10°C',
          '"รายงานการตรวจอุณหภูมิ" — สรุปผลตรวจทั้งซีกสุกรและชิ้นส่วนของวันที่เลือก เลือกวันที่แล้ว export เป็น Excel หรือ PDF ได้',
        ],
      },
      {
        key: 'pig-carcass-withdrawal',
        label: 'เบิกหมูซีก',
        href: '/basic/pig-carcass-withdrawal',
        icon: Package,
        summary: 'จัดลำดับ Lot หมูซีกที่จะเบิกเข้าสายการผลิต',
        body: [
          'ดึงรายการ Lot คงเหลือจากสต็อกมาแสดง กำหนดลำดับการเบิกของแต่ละ Lot กรอกจำนวนที่จะเทรียว (trimming) และบันทึกอุณหภูมิ/ห้อง Chill ของแต่ละ Lot แล้วกดบันทึก',
        ],
      },
      {
        key: 'shortage',
        label: 'รายการ Raw รอผลิต',
        href: '/basic/shortage/1',
        icon: AlertTriangle,
        summary: 'รายการวัตถุดิบที่สต็อกไม่พอสำหรับแผนผลิตของแต่ละ Phase',
        body: ['เลือกวันที่ดูรายการที่ต้องรอ STEP 2 เติมของ แล้วรีโหลดหรือ export เป็นรูปภาพ (PNG) ได้'],
        bullets: ['Phase 1', 'Phase 2', 'Phase 3'],
      },
      {
        key: 'production',
        label: 'คำสั่งผลิตราย Station',
        href: '/basic/production/sam-chan-basic',
        icon: ClipboardList,
        summary: 'ตาราง Gantt คำสั่งผลิต (งาน/พนักงาน/SKU/เป้าหมาย) ของแต่ละ Station',
        body: [
          'เลือกวันที่และ Phase แล้วกดปุ่ม "สร้าง Phase X" เพื่อให้ระบบคำนวณและจัดสรรงานผลิตอัตโนมัติจากยอดสั่งซื้อ/แผน 100%',
          'ดูผลเป็นผังเวลาการทำงานของพนักงานแต่ละคน — ใช้หน้ารูปแบบเดียวกันทั้ง 3 Station',
        ],
        bullets: ['Station สะโพกเบสิค', 'Station ไหล่เบสิค', 'Station สามชั้นเบสิค'],
      },
      {
        key: 'breakline',
        label: 'Breakline',
        href: '/basic/breakline',
        icon: Slice,
        summary: 'บันทึกเหตุการณ์สายการผลิตหยุดชะงัก',
        body: [
          'ระบุ Station ช่วงเวลาที่หยุด และสาเหตุ (เลือกจากรายการหรือพิมพ์เอง) เพื่อบันทึกแต่ละครั้งที่เกิดปัญหา',
          'ดูสรุป/ส่งออกรายงานเป็น Excel แยกตามสาเหตุและตาม Station ได้',
        ],
      },
    ],
  },
  {
    heading: 'Additional',
    items: [
      {
        key: 'carcass-yield',
        label: 'Yield หมูซีก',
        href: '/basic/carcass-yield',
        icon: FlaskConical,
        summary: 'คำนวณชิ้นส่วนที่จะได้จาก Lot หมูซีกที่มีอยู่',
        body: [
          'จับคู่น้ำหนักซากเฉลี่ยของแต่ละ Lot กับตาราง Mas Yield เพื่อประมาณน้ำหนัก (กก.) ของแต่ละกลุ่มสินค้าที่จะผลิตได้',
          'ดูภาพรวมแยกตามกลุ่มสินค้า (แท็บ Overview) หรือรายละเอียดต่อ Lot (แท็บ Detail) แล้วกดรีโหลดข้อมูลได้',
        ],
      },
      {
        key: 'yield-plan',
        label: 'แผนตาม Yield',
        href: '/basic/yield-plan/sa-phok-basic',
        icon: Layers,
        summary: 'ดูแผนผลิตของ Station ที่ปรับตามค่า Yield ที่คำนวณได้',
        body: ['เลือกวันที่และ Phase (หรือดูทั้งหมด) เพื่อดูว่าตามค่า Yield จริงแล้วควรผลิตปริมาณเท่าใด ใช้ view เดียวกับหน้าคำสั่งผลิตราย Station'],
        bullets: ['สะโพกเบสิค', 'ไหล่เบสิค', 'สามชั้นเบสิค'],
      },
      {
        key: 'carcass-cycle',
        label: 'รอบการลงหมูซีก',
        href: '/basic/carcass-cycle',
        icon: Timer,
        summary: 'คำนวณเวลาที่ใช้ในการลงหมูซีกแต่ละ Lot ตามลำดับที่เลือกไว้',
        body: [
          'ใช้อัตราการผลิต (กก./ชม. หรือ %) มาคำนวณระยะเวลาต่อ Lot — ปรับค่าอัตราแล้วระบบคำนวณเวลารวมให้อัตโนมัติ',
          'ข้อมูลรีเฟรชอัตโนมัติทุก 20 วินาทีเพื่อให้ตรงกับเครื่องอื่น',
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
        href: '/basic/upload-overview',
        icon: Layers,
        summary: 'รวมหน้าอัพโหลดคำสั่งซื้อ Makro/LOTUS/Wet Market และแผนผลิต 100% ไว้หน้าเดียว เป็นตารางช่องทาง × รอบเวลา',
        body: [
          'แต่ละแถวคือช่องทาง (Makro, LOTUS, Wet Market) แต่ละคอลัมน์คือรอบเวลา (8:00, 14:00, 16:00, แผน 100%) — ช่องที่ไม่ต้องใช้จะทึบเทาไว้ คลิกช่องว่างเพื่อเลือกไฟล์ ดูพรีวิว แล้วกดยืนยันอัพโหลด',
          'ปุ่ม "สร้าง Phase 1/2/3" อยู่เหนือคอลัมน์รอบที่ตรงกัน กดเพื่อสั่งสร้างแผนผลิตจากไฟล์ที่อัพโหลดของวันที่เลือกได้ทันที',
          'กดปุ่ม "แก้ไข" เพื่อเปิดโหมดลบไฟล์ที่อัพโหลดไปแล้วในแต่ละช่อง ส่วนด้านล่างมีตารางประวัติการอัพโหลดทั้งหมด กรองตามช่องทาง/รอบได้',
        ],
        bullets: [
          'Makro — รอบ 8:00 น. (คำสั่งซื้อรอบเช้า) และ 14:00 น. (คำสั่งซื้อรอบบ่าย หรือไฟล์แผนผลิต Makro 100%)',
          'LOTUS / Wet Market — รอบ 14:00 น. (คำสั่งซื้อรอบบ่าย), รอบ 16:00 น. (ข้อมูลย้อนหลัง 7 วัน สำหรับคำนวณ Phase 1) และแผน 100%',
          'ช่อง "แผน 100%" ของ LOTUS กับ Wet Market ใช้ไฟล์เดียวกัน ระบบจึงรวมเป็นกล่องเดียวคร่อม 2 แถว',
        ],
      },
      {
        key: 'supplementary-plan',
        label: 'แผนรอบเสริม',
        href: '/basic/supplementary-plan',
        icon: CalendarPlus,
        summary: 'อัพโหลดไฟล์ Excel ชีท "แผนรอบเสริม" ระบบกำหนด slot ให้อัตโนมัติ',
        body: ['กำหนด slot ตามเวลาที่อัพโหลด: ก่อน 14:00 = slot 1, ก่อน 16:00 = slot 2, หลังจากนั้น = slot 3'],
      },
      {
        key: 'stock-raw-material',
        label: 'Stock Raw Material',
        href: '/basic/stock-raw-material',
        icon: Package,
        summary: 'อัพโหลดข้อมูลสต็อกวัตถุดิบ 3 ไฟล์แยกกัน (รองรับ .xlsx/.xls/.csv)',
        body: ['อัพโหลด STOCK 0010, Stock คลัง 20 และ Stock คลัง 100 ตามประเภทที่กำหนด'],
      },
      {
        key: 'yield',
        label: 'รับผลได้',
        href: '/basic/yield',
        icon: TrendingUp,
        summary: 'อัพโหลดข้อมูลผลที่ได้รับจริงจากการผลิต (yield จริง)',
        body: ['เลือกไฟล์ Excel เพื่ออัพโหลด และดาวน์โหลดข้อมูลย้อนหลังกลับเป็น Excel ได้'],
      },
    ],
  },
  {
    heading: 'Master Logic การสร้างแผนผลิต',
    items: [
      {
        key: 'calculation',
        label: 'Master Calculation',
        href: '/basic/master-logic/calculation/mas-productivity-basic',
        icon: Calculator,
        summary: 'อัพโหลดไฟล์ตารางกฎ/ค่าคงที่ที่ระบบใช้คำนวณแผนผลิตฝั่งเบสิค',
        body: ['แต่ละประเภทเป็นฟอร์มอัพโหลดไฟล์ Excel เดียว ยิงไปคนละ API/ตารางปลายทางตามชนิดข้อมูล'],
        bullets: [
          'Mas Productivity Basic — อัตราการผลิตต่อ SKU ต่อสถานี',
          'Mas Channel Basic — ลำดับ Channel ต่อ Phase',
          'Mas %Variance Makro/Wet Market/LOTUS Basic — ปรับ % target ของแต่ละช่องทาง',
          'Mas Special Basic — ช่วงเวลาเริ่ม/หยุดผลิต SKU พิเศษ',
          'Mas กลุ่มสินค้าผลิตมากกว่า 1 สายพาน — กำหนด route/split mode/priority',
          'Mas สายพาน — mapping กลุ่มสินค้าไปสายพาน/สถานี',
          'BOM สินค้า — เชื่อม SAP สินค้ากับวัตถุดิบและ % Yield',
          'Mas หน่วยหยิบสินค้า — แปลงน้ำหนักเป็นจำนวนถุง',
          'Mas Yield — Yield % ตามน้ำหนักซาก ใช้โดยหน้า Yield หมูซีก/รอบการลงหมูซีก',
          'Mas Temp QC — เกณฑ์สี (เขียว/เหลือง/แดง) ของหน้าตรวจอุณหภูมิ',
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
        href: '/basic/admin/production-plan',
        icon: ShieldAlert,
        summary: 'แก้ไขแผนผลิตราย SKU ของสถานีเบสิค',
        body: [
          'เลือกวันที่/Phase ดูตารางยอดสั่งของแต่ละ SKU (ย้อนหลัง 3 วัน)',
          'แก้ไขยอดผลิต (คลิกแก้ไขตัวเลขแล้วบันทึก), เพิ่ม SKU ใหม่เข้าแผน, หรือลบ SKU ทั้ง Phase ออกจากแผนได้',
        ],
      },
      {
        key: 'admin-users',
        label: 'User ระบบผลิต',
        href: '/basic/admin/users',
        icon: Users,
        summary: 'จัดการผู้ใช้งานระบบผลิต ใช้ร่วมกันทั้ง STEP 2 และ STEP 3',
        body: ['เพิ่ม User ใหม่, อัพโหลดรายชื่อ User จากไฟล์ Excel (พร้อม preview ก่อนยืนยัน), แก้ไขรหัสผ่าน, หรือลบ User ได้'],
      },
      {
        key: 'admin-plan-check',
        label: 'ตรวจสอบแผนผลิต',
        href: '/basic/admin/plan-check',
        icon: ClipboardCheck,
        summary: 'เทียบแผน 100% (ยอดสั่งซื้อ) กับยอดผลิตจริง แยกตามสถานีและ SKU',
        body: ['เลือกวันที่ผลิตแล้วดูตารางสรุป พร้อมหมายเหตุสต็อกยกมา/ส่วนเกิน/ส่วนขาดในแต่ละช่องทาง เพื่อตรวจสอบว่าผลิตครบตามแผนหรือไม่'],
      },
    ],
  },
]

export const basicManualGroups: ManualGroup[] = RAW_BASIC_GROUPS.map(g => ({
  ...g,
  items: g.items.map(i => ({
    ...i,
    image: `/manual-screenshots/basic/${i.key}.jpg`,
    imageCaption: MASTER_LOGIC_KEYS.includes(i.key)
      ? 'ตัวอย่างข้อมูลหลังเลือกไฟล์ (ข้อมูลสมมติ ไม่ใช่ข้อมูลพนักงาน/การผลิตจริง)'
      : undefined,
  })),
}))
