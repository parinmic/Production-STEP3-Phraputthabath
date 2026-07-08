import {
  LayoutDashboard, Thermometer, Package, AlertTriangle, ClipboardList, Slice, CalendarDays,
  FlaskConical, Layers, Timer, Users, CalendarPlus,
  TrendingUp, UserCog, Calculator, ShieldAlert, ClipboardCheck,
} from 'lucide-react'
import type { ManualGroup, ManualOverview } from '@/components/ManualLayout'

export const basicOverview: ManualOverview = {
  description: 'ระบบฝั่งเบสิค (STEP 2) ต้องมีข้อมูลตั้งต้นให้ครบก่อน ถึงจะใช้หน้าอื่นๆ ได้เต็มที่ ทำตามลำดับนี้ในการใช้งานครั้งแรกของแต่ละวัน',
  steps: [
    {
      title: 'Master Logic',
      description: 'อัพโหลดกำลังคนแต่ละสถานี, Master Calculation, BOM, Mas Yield และ Mas Temp QC ให้ครบก่อน',
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
const MASTER_LOGIC_KEYS = ['manpower', 'calculation']

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
        body: [],
        mobileSections: [
          {
            title: 'ภาพรวม',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/home-mobile.jpg', caption: 'หน้าภาพรวม',
                markers: [
                  { n: 1, x: '50%', y: '34.2%' },
                  { n: 2, x: '50%', y: '43.7%' },
                  { n: 3, x: '50%', y: '53.2%' },
                ],
              },
            ],
            description: [
              'การ์ด "Station สะโพกเบสิค" — ไปหน้าคำสั่งผลิตของ Station สะโพกเบสิค',
              'การ์ด "Station ไหล่เบสิค" — ไปหน้าคำสั่งผลิตของ Station ไหล่เบสิค',
              'การ์ด "Station สามชั้นเบสิค" — ไปหน้าคำสั่งผลิตของ Station สามชั้นเบสิค (การ์ดที่ไม่มีสิทธิ์เข้าจะจางและกดไม่ได้)',
            ],
          },
        ],
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
        body: [],
        mobileSections: [
          {
            title: 'อุณหภูมิหมูซีก',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/temperature-check-mobile-1.jpg', caption: 'รายการ Lot',
                markers: [
                  { n: 1, x: '73.6%', y: '26.4%' },
                  { n: 2, x: '25.6%', y: '26.4%' },
                  { n: 3, x: '74.4%', y: '21.1%' },
                  { n: 4, x: '91%', y: '38.5%' },
                ],
              },
              {
                src: '/manual-screenshots/basic/mobile/temperature-check-mobile-1b.jpg', caption: 'กดแถวเพื่อกรอก',
                markers: [
                  { n: 5, x: '26.7%', y: '48%' },
                  { n: 6, x: '73.3%', y: '48%' },
                ],
              },
            ],
            description: [
              'ปุ่ม "Generate" — ดึงรายการ Lot หมูซีกที่รอผลิตจากสต็อกมาแสดงเป็นรายการให้กรอก (กดครั้งแรกของแต่ละวัน/รอบ)',
              'ปุ่ม "รีโหลด" — ดึงข้อมูลล่าสุดจากเซิร์ฟเวอร์มาแสดง โดยไม่สร้างรายการ Lot ใหม่ ใช้ตอนต้องการเช็คค่าที่เครื่องอื่นเพิ่งบันทึก',
              'Dropdown "รอบที่ x" (มุมขวา) — สลับดูข้อมูลของรอบตรวจก่อนหน้าในวันเดียวกัน (แต่ละรอบมีอายุ 1 ชั่วโมงนับจากบันทึกครั้งแรก)',
              'แตะที่แถว Lot หรือลูกศร ▾ — เปิด/ปิดฟอร์มกรอกอุณหภูมิของ Lot นั้น ภายในฟอร์มมีช่องให้เลือก "ห้อง Chill" และกรอก "อุณหภูมิห้อง" รวมถึงตารางกรอกอุณหภูมิ "สะโพก" ของตัวที่ 1-3 แยกชุดต้น Lot/ชุดท้าย Lot',
              'ปุ่ม "ล้างค่า" (สีแดง) — ล้างค่าที่กรอกในฟอร์มของ Lot นั้นทั้งหมด (ต้องกดยืนยันอีกครั้ง)',
              'ปุ่ม "บันทึก" (สีน้ำเงิน) — เปิดกล่องให้พิมพ์ชื่อผู้บันทึก แล้วกด "ยืนยันบันทึก" ระบบจะคำนวณค่าเฉลี่ยและเทียบเกณฑ์สี (เขียว/เหลือง/แดง) ให้อัตโนมัติ',
            ],
          },
          {
            title: 'อุณหภูมิชิ้นส่วน',
            images: [
              { src: '/manual-screenshots/basic/mobile/temperature-check-mobile-2.jpg', caption: 'รายการ Lot' },
              { src: '/manual-screenshots/basic/mobile/temperature-check-mobile-2b.jpg', caption: 'กดแถวเพื่อกรอก' },
            ],
            description: [
              'ปุ่มและวิธีใช้เหมือนหน้าอุณหภูมิหมูซีกทุกอย่าง (Generate / รีโหลด / กดแถวเพื่อเปิดฟอร์ม / ล้างค่า / บันทึก)',
              'ต่างกันที่ฟอร์มกรอกมี 5 จุดวัด (สะโพก สันนอก สามชั้น ไหล่ สันคอ) — ถ้าตารางกว้างเกินจอ ให้ปัดซ้าย-ขวาเพื่อดูคอลัมน์ที่เหลือ เกณฑ์ผ่านคือ ≤ 10°C',
            ],
          },
          {
            title: 'รายงานการตรวจอุณหภูมิ',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/temperature-check-mobile-3.jpg', caption: 'รายงานสรุป',
                markers: [
                  { n: 1, x: '22.7%', y: '21.6%' },
                  { n: 2, x: '56.4%', y: '21.6%' },
                  { n: 3, x: '82.8%', y: '21.6%' },
                ],
              },
            ],
            description: [
              'ช่องเลือกวันที่ — ดูรายงานสรุปของวันที่ต้องการ',
              'ปุ่ม "รีโหลด" — ดึงข้อมูลล่าสุดของวันที่เลือกมาแสดงใหม่',
              'ปุ่ม "Export" — เปิดเมนูเลือกดาวน์โหลดรายงานเป็นไฟล์ PDF หรือ Excel',
            ],
          },
        ],
      },
      {
        key: 'pig-carcass-withdrawal',
        label: 'เบิกหมูซีก',
        href: '/basic/pig-carcass-withdrawal',
        icon: Package,
        summary: 'จัดลำดับ Lot หมูซีกที่จะเบิกเข้าสายการผลิต',
        body: [],
        mobileSections: [
          {
            title: 'เบิกหมูซีก',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/pig-carcass-withdrawal-mobile.jpg', caption: 'เบิกหมูซีก',
                markers: [
                  { n: 1, x: '84.9%', y: '16.9%' },
                  { n: 2, x: '81.1%', y: '25.2%' },
                  { n: 3, x: '50.3%', y: '45%' },
                  { n: 4, x: '89.5%', y: '59.2%' },
                ],
              },
            ],
            description: [
              'ปุ่ม "รีโหลด" — ดึงรายการ Lot คงเหลือจากสต็อกมาแสดงใหม่',
              'ปุ่ม "บันทึก" — บันทึกลำดับการเบิก/จำนวนตัดแต่งที่กรอกไว้ (กดได้เมื่อมีการแก้ไขค้างอยู่เท่านั้น)',
              'ช่อง "จำนวนตัดแต่งหมู" — กรอกจำนวนตัวที่จะเทรียว ระบบจะเทียบกับจำนวนตัวที่เลือกเบิกแล้วบอกว่าขาด/เกิน',
              'ช่องตัวเลขท้ายแถว (1, 2, 3...) — กดเพื่อกำหนดลำดับการเบิกของ Lot นั้น เลือก "-" เพื่อยกเลิกลำดับ',
            ],
          },
        ],
      },
      {
        key: 'shortage',
        label: 'รายการ Raw รอผลิต',
        href: '/basic/shortage/1',
        icon: AlertTriangle,
        summary: 'รายการวัตถุดิบที่สต็อกไม่พอสำหรับแผนผลิตของแต่ละ Phase',
        body: [],
        mobileSections: (['1', '2', '3'] as const).map(phase => ({
          title: `Phase ${phase}`,
          images: [
            {
              src: `/manual-screenshots/basic/mobile/shortage-mobile-${phase}.jpg`, caption: `Phase ${phase}`,
              markers: [
                { n: 1, x: '42.6%', y: '26.2%' },
                { n: 2, x: '77.8%', y: '26.2%' },
                { n: 3, x: '88.3%', y: '26.2%' },
              ],
            },
          ],
          description: [
            'ช่องเลือกวันที่ — ดูรายการวัตถุดิบขาดของวันที่ต้องการ',
            'ปุ่ม "รีโหลด" — ดึงรายการล่าสุดของวันที่เลือกมาแสดงใหม่',
            'ปุ่ม Export (ไอคอนดาวน์โหลด) — บันทึกตารางที่เห็นเป็นรูปภาพ (PNG) เพื่อส่งต่อหรือปริ้นได้',
          ],
        })),
      },
      {
        key: 'production',
        label: 'คำสั่งผลิตราย Station',
        href: '/basic/production/sam-chan-basic',
        icon: ClipboardList,
        summary: 'ตาราง Gantt คำสั่งผลิต (งาน/พนักงาน/SKU/เป้าหมาย) ของแต่ละ Station',
        body: [],
        bullets: ['ใช้หน้ารูปแบบเดียวกันทั้ง 3 Station: สะโพกเบสิค, ไหล่เบสิค, สามชั้นเบสิค'],
        mobileSections: [
          {
            title: 'คำสั่งผลิตราย Station',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/production-mobile.jpg', caption: 'คำสั่งผลิตราย Station',
                markers: [
                  { n: 1, x: '14.1%', y: '23.1%' },
                  { n: 2, x: '37.9%', y: '23.1%' },
                  { n: 3, x: '61.8%', y: '23.1%' },
                  { n: 4, x: '85.9%', y: '23.1%' },
                  { n: 5, x: '52.6%', y: '30.8%' },
                  { n: 6, x: '50%', y: '36.3%' },
                  { n: 7, x: '26.2%', y: '42.1%' },
                  { n: 8, x: '73.8%', y: '42.1%' },
                  { n: 9, x: '26.2%', y: '47.3%' },
                ],
              },
            ],
            description: [
              'ปุ่ม "ทั้งหมด" — ดูทุก Phase รวมกันในตารางเดียว',
              'ปุ่ม "Phase 1" (8:30-14:30) — สลับดู/สร้างแผนของรอบเช้า',
              'ปุ่ม "Phase 2" (14:30-16:30) — สลับดู/สร้างแผนของรอบบ่าย',
              'ปุ่ม "Phase 3" (16:30 เป็นต้นไป) — สลับดู/สร้างแผนของรอบค่ำ (แผน 100%)',
              'ช่องเลือกวันที่ — เลือกวันที่ต้องการดู/สร้างแผนผลิต',
              'ปุ่ม "สร้าง Phase X" — ให้ระบบคำนวณและจัดสรรงานผลิตอัตโนมัติจากยอดสั่งซื้อ/แผน 100% และกำลังคนที่มี ของ Phase ที่เลือกอยู่',
              'แท็บ "ภาพรวม" — ผังเวลาการทำงาน (Gantt) ของพนักงานแต่ละคน',
              'แท็บ "รายสาขา (Makro)" — กระจายยอดผลิตตามสัดส่วนออเดอร์รายสาขาของ Makro',
              'แท็บ "สรุปแผนผลิต" — สรุปยอดแผนผลิตรวมของ Phase ที่เลือก (บนมือถือไม่มีปุ่ม Export Excel — ต้องใช้จอคอมพิวเตอร์เพื่อดาวน์โหลด)',
            ],
          },
        ],
      },
      {
        key: 'breakline',
        label: 'Breakline',
        href: '/basic/breakline',
        icon: Slice,
        summary: 'บันทึกเหตุการณ์สายการผลิตหยุดชะงัก',
        body: [],
        mobileSections: [
          {
            title: 'Breakline',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/breakline-mobile.jpg', caption: 'Breakline',
                markers: [
                  { n: 1, x: '39.1%', y: '23.5%' },
                  { n: 2, x: '87.1%', y: '23.5%' },
                  { n: 3, x: '50%', y: '40.3%' },
                  { n: 4, x: '28.5%', y: '49.3%' },
                  { n: 5, x: '71.5%', y: '49.3%' },
                  { n: 6, x: '50%', y: '59.2%' },
                  { n: 7, x: '28.2%', y: '65.5%' },
                ],
              },
            ],
            description: [
              'ช่องเลือกวันที่ — ดู Breakline ของวันที่ต้องการ',
              'ปุ่ม "Excel" — ส่งออกรายงานสรุป Breakline ของวันนั้นแยกตามสาเหตุและตาม Station',
              'Dropdown "สถานี" — เลือก Station ที่หยุดสาย (หรือ "ทั้งหมด" ถ้ากระทบทุก Station)',
              'Dropdown "เวลาเริ่ม" — เลือกเวลาที่เริ่มหยุดสาย',
              'Dropdown "เวลาสิ้นสุด" — เลือกเวลาที่กลับมาทำงานต่อ (เลือกเวลาเริ่มก่อน)',
              'Dropdown "สาเหตุ" — เลือกสาเหตุจากรายการ หรือพิมพ์เหตุผลเองได้',
              'ปุ่ม "บันทึก Breakline" — บันทึกเหตุการณ์ครั้งนี้เข้าระบบ จะไปแสดงบน Gantt คำสั่งผลิตราย Station ด้วย',
            ],
          },
        ],
      },
      {
        key: 'workforce-daily-status',
        label: 'ตรวจสอบสถานะกำลังคน',
        href: '/basic/workforce-daily-status',
        icon: CalendarDays,
        summary: 'ดูรายชื่อ/สถานีของพนักงานที่ทำงานวันนั้น (ดูอย่างเดียว)',
        body: [
          'หน้านี้ดูอย่างเดียว (read-only) ไม่มีการแก้ไขสถานะพนักงานในหน้านี้แล้ว ดึงข้อมูลจากตาราง employee_skills กลาง (Sync อัตโนมัติทุกวัน 08:05 น.)',
          'ข้อควรระวัง: ชื่อ Station อย่าง "สะโพก/สามชั้น/ไหล่" ใช้ชื่อเดียวกันทั้งฝั่งเบสิคและฝั่งพิเศษในข้อมูลต้นทาง ตัวเลขที่เห็นจึงอาจรวมพนักงานอีกฝั่งที่ทำ Station ชื่อเดียวกันปนมาด้วย ไม่ใช่ยอดเฉพาะฝั่งเบสิคล้วนๆ',
        ],
        mobileSections: [
          {
            title: 'ตรวจสอบสถานะกำลังคน',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/workforce-daily-status-mobile.jpg', caption: 'ตรวจสอบสถานะกำลังคน',
                markers: [
                  { n: 1, x: '36.8%', y: '39.9%' },
                  { n: 2, x: '74.5%', y: '39.9%' },
                  { n: 3, x: '19.6%', y: '46%' },
                  { n: 4, x: '61.7%', y: '46%' },
                ],
              },
            ],
            description: [
              'ช่องเลือกวันที่ — ดูกำลังคนของวันที่ต้องการ',
              'Dropdown "ทุก Station" — กรองดูเฉพาะ Station ที่ต้องการ',
              'Dropdown "ทุกกะ" — กรองดูเฉพาะกะ 1 หรือกะ 2',
              'ช่องค้นหาชื่อ — พิมพ์ชื่อพนักงานเพื่อกรองรายชื่อ',
            ],
          },
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
        ],
        mobileSections: [
          {
            title: 'ภาพรวมทุก Lot',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/carcass-yield-mobile.jpg', caption: 'ภาพรวมทุก Lot',
                markers: [
                  { n: 1, x: '84.9%', y: '16.7%' },
                  { n: 2, x: '55.3%', y: '28.2%' },
                  { n: 3, x: '50%', y: '40%' },
                ],
              },
            ],
            description: [
              'ปุ่ม "รีโหลด" — ดึงข้อมูล Lot และไฟล์ Mas Yield ล่าสุดมาคำนวณใหม่',
              'แท็บ "รายละเอียด Lot" — สลับไปดูผลคำนวณ Yield ทีละ Lot แทนภาพรวมทุก Lot',
              'Dropdown "เลือกกลุ่มชิ้นส่วน" — กรองตารางให้เหลือเฉพาะกลุ่มสินค้าที่ต้องการดู',
            ],
          },
          {
            title: 'รายละเอียด Lot',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/carcass-yield-mobile-2.jpg', caption: 'รายละเอียด Lot',
                markers: [
                  { n: 1, x: '50%', y: '40%' },
                  { n: 2, x: '50%', y: '49.1%' },
                ],
              },
            ],
            description: [
              'Dropdown "เลือก Lot" — เลือก Lot หมูซีกที่ต้องการดูผลคำนวณ Yield รายกลุ่มชิ้นส่วน',
              'Dropdown "เลือกกลุ่มชิ้นส่วน" — กรองผลลัพธ์ของ Lot นั้นให้เหลือเฉพาะกลุ่มที่ต้องการ',
            ],
          },
        ],
      },
      {
        key: 'yield-plan',
        label: 'แผนตาม Yield',
        href: '/basic/yield-plan/sa-phok-basic',
        icon: Layers,
        summary: 'ดูแผนผลิตของ Station ที่ปรับตามค่า Yield ที่คำนวณได้',
        body: [],
        bullets: ['ใช้ view เดียวกับหน้าคำสั่งผลิตราย Station — มีให้เลือก 3 Station: สะโพกเบสิค, ไหล่เบสิค, สามชั้นเบสิค'],
        mobileSections: [
          {
            title: 'แผนตาม Yield',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/yield-plan-mobile.jpg', caption: 'แผนตาม Yield',
                markers: [
                  { n: 1, x: '11.1%', y: '22.6%' },
                  { n: 2, x: '30.2%', y: '22.6%' },
                  { n: 3, x: '51.4%', y: '22.6%' },
                  { n: 4, x: '75.3%', y: '22.6%' },
                  { n: 5, x: '77.3%', y: '28.7%' },
                  { n: 6, x: '85.4%', y: '35.4%' },
                ],
              },
            ],
            description: [
              'ปุ่ม "ทั้งหมด" — ดูทุก Phase รวมกัน',
              'ปุ่ม "Phase 1" — ดูแผนตาม Yield ของรอบเช้า',
              'ปุ่ม "Phase 2" — ดูแผนตาม Yield ของรอบบ่าย',
              'ปุ่ม "Phase 3" — ดูแผนตาม Yield ของรอบค่ำ',
              'ช่องเลือกวันที่ — เลือกวันที่ต้องการดู',
              'ปุ่ม "รีโหลด" — ดึงค่า Yield/แผนผลิตล่าสุดมาคำนวณใหม่',
            ],
          },
        ],
      },
      {
        key: 'carcass-cycle',
        label: 'รอบการลงหมูซีก',
        href: '/basic/carcass-cycle',
        icon: Timer,
        summary: 'คำนวณเวลาที่ใช้ในการลงหมูซีกแต่ละ Lot ตามลำดับที่เลือกไว้',
        body: ['ข้อมูลรีเฟรชอัตโนมัติทุก 20 วินาทีเพื่อให้ตรงกับเครื่องอื่น'],
        mobileSections: [
          {
            title: 'รอบการลงหมูซีก',
            images: [
              {
                src: '/manual-screenshots/basic/mobile/carcass-cycle-mobile.jpg', caption: 'รอบการลงหมูซีก',
                markers: [
                  { n: 1, x: '84.9%', y: '16.7%' },
                  { n: 2, x: '53.4%', y: '30.3%' },
                ],
              },
            ],
            description: [
              'ปุ่ม "รีโหลด" — ดึงลำดับ Lot ที่เลือกเบิก (จากหน้าเบิกหมูซีก) มาคำนวณเวลาใหม่',
              'ช่อง "อัตราการลงหมูซีก" (วิ/ตัว) — ปรับอัตราเวลาต่อตัว ระบบคำนวณเวลารวมของแต่ละกลุ่มชิ้นส่วนให้อัตโนมัติ',
            ],
          },
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
        summary: 'ตารางอัพโหลดคำสั่งซื้อ Makro/LOTUS/Wet Market รวมทุกช่องทางและรอบเวลาไว้หน้าเดียว พร้อมปุ่มสร้างแผนผลิต',
        body: [
          'ตารางแถว = ช่องทาง (Makro/LOTUS/Wet Market), คอลัมน์ = รอบเวลา (8:00, 14:00, 16:00, แผน 100%) — คลิกกล่องที่ยังว่าง (มีไอคอนลากไฟล์) เพื่อเลือกหรือลากไฟล์ Excel/CSV เข้าไปวาง กล่องที่มีไฟล์แล้วของวันที่เลือกจะเป็นสีเขียว กล่องสีเทาทึบคือรอบที่ไม่ต้องอัพโหลดในระบบปัจจุบัน',
          'แผน 100% ของ LOTUS และ Wet Market ใช้ไฟล์เดียวกัน จึงรวมเป็นกล่องใหญ่กล่องเดียวคร่อม 2 แถว',
        ],
        imageMarkers: [
          { n: 1, x: '92.5%', y: '11.6%' },
          { n: 2, x: '11.3%', y: '27.6%' },
          { n: 3, x: '32%', y: '21.1%' },
          { n: 4, x: '50.4%', y: '21.1%' },
          { n: 5, x: '87.3%', y: '21.1%' },
          { n: 6, x: '85.3%', y: '58.7%' },
          { n: 7, x: '93%', y: '58.7%' },
        ],
        imageDescription: [
          'ช่องเลือกวันที่ — กล่องอัพโหลดและปุ่มสร้าง Phase จะอ้างอิงวันที่นี้',
          'ปุ่ม "แก้ไข" — สลับเป็นโหมดแก้ไขเพื่อกดปุ่ม ✕ ลบไฟล์ที่อัพโหลดผิดออกได้ (ต้องมีสิทธิ์ Edit ของช่องทางนั้น)',
          'ปุ่ม "สร้าง Phase 1" — สร้างแผนผลิตจากยอดที่อัพโหลดของคอลัมน์ 8:00',
          'ปุ่ม "สร้าง Phase 2" — สร้างแผนผลิตจากยอดที่อัพโหลดของคอลัมน์ 14:00',
          'ปุ่ม "สร้าง Phase 3" — สร้างแผนผลิตจากยอดที่อัพโหลดของคอลัมน์แผน 100%',
          'Dropdown "ทุกช่องทาง" — กรองประวัติการอัพโหลดด้านล่างเฉพาะช่องทางที่ต้องการ',
          'Dropdown "ทุกรอบ" — กรองประวัติการอัพโหลดด้านล่างเฉพาะรอบเวลาที่ต้องการ',
        ],
      },
      {
        key: 'supplementary-plan',
        label: 'แผนรอบเสริม',
        href: '/basic/supplementary-plan',
        icon: CalendarPlus,
        summary: 'อัพโหลดไฟล์ Excel ชีท "แผนรอบเสริม" ระบบกำหนด slot ให้อัตโนมัติ',
        body: ['กำหนด slot ตามเวลาที่อัพโหลด: ก่อน 14:00 = slot 1, ก่อน 16:00 = slot 2, หลังจากนั้น = slot 3'],
        imageMarkers: [
          { n: 1, x: '52.3%', y: '38.4%' },
          { n: 2, x: '92.7%', y: '58.9%' },
          { n: 3, x: '95.1%', y: '58.9%' },
        ],
        imageDescription: [
          'ช่องลากไฟล์/คลิกเพื่อเลือกไฟล์ — เลือกไฟล์ Excel ที่มี sheet ชื่อ "แผนรอบเสริม"',
          'ไอคอนดาวน์โหลด (แต่ละแถวในประวัติ) — ดาวน์โหลดไฟล์ที่เคยอัพโหลดกลับมาเป็น Excel',
          'ไอคอน ✕ (แต่ละแถวในประวัติ) — ลบไฟล์ที่อัพโหลดผิดออกจากระบบ',
        ],
      },
      {
        key: 'stock-raw-material',
        label: 'Stock Raw Material',
        href: '/basic/stock-raw-material',
        icon: Package,
        summary: 'อัพโหลดข้อมูลสต็อกวัตถุดิบ 3 ไฟล์แยกกัน (รองรับ .xlsx/.xls/.csv)',
        body: [],
        imageMarkers: [
          { n: 1, x: '21.4%', y: '25.6%' },
          { n: 2, x: '52.3%', y: '25.6%' },
          { n: 3, x: '83.1%', y: '25.6%' },
        ],
        imageDescription: [
          'ช่องอัพโหลด "ไฟล์ STOCK 0010" — สต็อกจากคลัง 0010',
          'ช่องอัพโหลด "ไฟล์ Stock คลัง 20" — สต็อกจากคลัง 20',
          'ช่องอัพโหลด "ไฟล์ Stock คลัง 100" — สต็อกจากคลัง 100 (ต้องอัพโหลดครบทั้ง 3 ไฟล์)',
        ],
      },
      {
        key: 'yield',
        label: 'รับผลได้',
        href: '/basic/yield',
        icon: TrendingUp,
        summary: 'อัพโหลดข้อมูลผลที่ได้รับจริงจากการผลิต (yield จริง)',
        body: [],
        imageMarkers: [
          { n: 1, x: '21.8%', y: '23.9%' },
          { n: 2, x: '52.3%', y: '39.8%' },
        ],
        imageDescription: [
          'ช่อง "วันที่ผลิต" — ระบุวันที่ของข้อมูล yield ที่จะอัพโหลด',
          'ช่องลากไฟล์/คลิกเพื่อเลือกไฟล์ — เลือกไฟล์ Excel ผลที่ได้รับจริง แล้วดาวน์โหลดประวัติย้อนหลังกลับเป็น Excel ได้จากรายการด้านล่าง',
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
        href: '/basic/master-logic/manpower/sa-phok-basic',
        icon: UserCog,
        summary: 'อัพโหลด Master Logic กำลังคนแยกตามสถานี — ใช้เป็นฐานคำนวณตอนกด "สร้าง Phase"',
        body: [],
        bullets: ['ใช้รูปแบบฟอร์มเดียวกันทุกประเภท เปลี่ยนแค่ปลายทางที่บันทึก: สะโพกเบสิค, ไหล่เบสิค, สามชั้นเบสิค, เปิดหมู'],
        imageMarkers: [{ n: 1, x: '52.3%', y: '29.1%' }],
        imageDescription: ['ช่องลากไฟล์/คลิกเพื่อเลือกไฟล์ — เลือกไฟล์ Excel กำลังคนของสถานีนั้น (เลือกสถานีจากเมนูด้านซ้ายก่อน)'],
      },
      {
        key: 'calculation',
        label: 'Master Calculation',
        href: '/basic/master-logic/calculation/mas-productivity-basic',
        icon: Calculator,
        summary: 'อัพโหลดไฟล์ตารางกฎ/ค่าคงที่ที่ระบบใช้คำนวณแผนผลิตฝั่งเบสิค',
        body: [],
        imageMarkers: [{ n: 1, x: '52.3%', y: '29.1%' }],
        imageDescription: ['ช่องลากไฟล์/คลิกเพื่อเลือกไฟล์ — แต่ละประเภทเป็นฟอร์มอัพโหลดไฟล์ Excel เดียว ยิงไปคนละ API/ตารางปลายทางตามชนิดข้อมูล (เลือกประเภทจากเมนูด้านซ้ายก่อน)'],
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
        body: ['ผู้ใช้ที่มีสิทธิ์เมนูนี้เป็น View (ดูอย่างเดียว) จะเห็นตารางแต่กดแก้ไข/เพิ่ม/ลบไม่ได้ ต้องมีสิทธิ์ Edit เท่านั้น'],
        bullets: ['แต่ละแถวมีไอคอนดินสอสำหรับแก้ไขยอดผลิต และปุ่ม "เฉลี่ย 7 วัน" ที่หัวตารางเพื่อดูค่าเฉลี่ยย้อนหลัง — ทั้งสองปรากฏเมื่อมีข้อมูลแผนผลิตของวันที่เลือกแล้วเท่านั้น'],
        imageMarkers: [
          { n: 1, x: '18.7%', y: '23.9%' },
          { n: 2, x: '33.5%', y: '23.9%' },
          { n: 3, x: '42.1%', y: '23.9%' },
          { n: 4, x: '92.1%', y: '23.9%' },
          { n: 5, x: '12.6%', y: '33.7%' },
        ],
        imageDescription: [
          'ช่องเลือกวันที่ — ดูแผนผลิตของวันที่ต้องการ (ย้อนหลังได้ 3 วัน)',
          'Dropdown "Phase" — กรองดูเฉพาะ Phase เช้า/บ่าย/ค่ำ หรือทั้งหมด',
          'ปุ่ม "รีโหลด" — ดึงข้อมูลล่าสุดมาแสดงใหม่',
          'ปุ่ม "เพิ่ม SKU" — เปิดฟอร์มเพิ่ม SKU ใหม่เข้าแผน (ระบุวันที่ Phase Station SKU ช่องทาง และยอดผลิต)',
          'ปุ่ม "ลบ Phase ... ทั้งหมด" — ลบ SKU ทั้งหมดของ Phase นั้นออกจากแผน (มีกล่องยืนยันก่อนลบจริง)',
        ],
      },
      {
        key: 'admin-users',
        label: 'User ระบบผลิต',
        href: '/basic/admin/users',
        icon: Users,
        summary: 'จัดการผู้ใช้งานระบบผลิต ใช้ร่วมกันทั้ง STEP 2 และ STEP 3',
        body: ['แต่ละเมนูที่มอบสิทธิ์ให้ User กำหนดระดับการเข้าถึงได้ 2 แบบ คือ Edit (แก้ไขได้) หรือ View (ดูอย่างเดียว) — ในไฟล์ Excel ที่อัพโหลด ให้กรอกเลขเมนูลงช่อง "Edit" หรือ "View" ตามสิทธิ์ที่ต้องการ'],
        imageMarkers: [
          { n: 1, x: '72.8%', y: '12.7%' },
          { n: 2, x: '84.1%', y: '12.7%' },
          { n: 3, x: '93.8%', y: '12.7%' },
          { n: 4, x: '90.8%', y: '30%' },
          { n: 5, x: '93.2%', y: '30%' },
          { n: 6, x: '95.5%', y: '30%' },
        ],
        imageDescription: [
          'ปุ่ม "ดาวน์โหลด Excel" — ส่งออกรายชื่อ User และตำแหน่งทั้งหมดเป็นไฟล์ Excel',
          'ปุ่ม "อัพโหลด Excel" — เลือกไฟล์ Excel รายชื่อ User เพื่อนำเข้าแบบเป็นชุด (มีตัวอย่าง preview ก่อนยืนยัน)',
          'ปุ่ม "เพิ่ม User" — เปิดฟอร์มเพิ่ม User ทีละคน (เลือกตำแหน่ง กรอก Username/Password)',
          'ไอคอนกุญแจ (ต่อแถว) — เปลี่ยนรหัสผ่านของ User นั้น',
          'ไอคอนปิด/เปิดใช้งาน (ต่อแถว) — สลับสถานะ User ระหว่างใช้งาน/ปิดใช้งาน',
          'ไอคอนถังขยะ (ต่อแถว) — ลบ User นั้นออกจากระบบ (มีข้อความยืนยันก่อนลบจริง)',
        ],
      },
      {
        key: 'admin-plan-check',
        label: 'ตรวจสอบแผนผลิต',
        href: '/basic/admin/plan-check',
        icon: ClipboardCheck,
        summary: 'เทียบแผน 100% (ยอดสั่งซื้อ) กับยอดผลิตจริง แยกตามสถานีและ SKU',
        body: ['หน้านี้ดูอย่างเดียว — เทียบยอดจากตารางสต็อกยกมา/ส่วนเกิน/ส่วนขาดในแต่ละช่องทาง เพื่อตรวจสอบว่าผลิตครบตามแผนหรือไม่'],
        imageMarkers: [
          { n: 1, x: '21.8%', y: '25.7%' },
          { n: 2, x: '31.5%', y: '25.7%' },
        ],
        imageDescription: [
          'ช่องเลือก "วันที่ผลิต" — ดูรายงานเทียบแผนของวันที่ต้องการ',
          'ปุ่ม "รีโหลด" — ดึงข้อมูลล่าสุดของวันที่เลือกมาแสดงใหม่',
        ],
      },
    ],
  },
]

export const basicManualGroups: ManualGroup[] = RAW_BASIC_GROUPS.map(g => ({
  ...g,
  items: g.items.map(i => (
    // Items with a mobile screenshot set (หน้าหลัก / คำสั่งเบิกและผลิต / Additional — the
    // only groups shown on the mobile sidebar) show the mobile view only, no desktop shot.
    (i.mobileImages?.length || i.mobileSections?.length)
      ? i
      : {
          ...i,
          image: `/manual-screenshots/basic/${i.key}.jpg`,
          imageCaption: MASTER_LOGIC_KEYS.includes(i.key)
            ? 'ตัวอย่างข้อมูลหลังเลือกไฟล์ (ข้อมูลสมมติ ไม่ใช่ข้อมูลพนักงาน/การผลิตจริง)'
            : undefined,
        }
  )),
}))
