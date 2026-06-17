import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

type LotInfo = { prod_date: string; to_withdraw: number; insufficient?: boolean }
type ItemData = {
  sku: string
  sku_name: string | null
  quantity: number
  unit: string
  work_station: string | null
  note: string | null
  lots?: LotInfo[]
  withdrawal_round?: string
}
type CfgData = { label: string; time: string; color: string }

const STATION_DISPLAY: Record<string, string> = {
  'สามชั้น': 'สามชั้นพิเศษ',
  'สะโพก':   'สะโพกพิเศษ',
  'ไหล่':    'ไหล่พิเศษ',
  'เผาขา':   'เผาขาพิเศษ',
  'เลาะขา':  'เลาะขาพิเศษ',
}
const PHASE_COLOR: Record<string, [number, number, number]> = {
  blue:   [37,  99,  235],
  orange: [249, 115,  22],
  purple: [147,  51, 234],
}

let fontCacheReg: string | null = null
let fontCacheBold: string | null = null

async function fetchFont(url: string): Promise<string> {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

async function loadFonts(doc: jsPDF) {
  if (!fontCacheReg) {
    fontCacheReg = await fetchFont('https://fonts.gstatic.com/s/sarabun/v17/DtVmJx26TKEr37c9YK5sulw.ttf')
  }
  if (!fontCacheBold) {
    fontCacheBold = await fetchFont('https://fonts.gstatic.com/s/sarabun/v17/DtVjJx26TKEr37c9WBI.ttf')
  }
  doc.addFileToVFS('Sarabun-Regular.ttf', fontCacheReg)
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal')
  doc.addFileToVFS('Sarabun-Bold.ttf', fontCacheBold)
  doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold')
}

function groupLots(lots: LotInfo[]) {
  const map = new Map<string, { qty: number; insufficient: boolean }>()
  for (const lot of lots) {
    const key = lot.insufficient ? '__i__' : lot.prod_date
    const cur = map.get(key) ?? { qty: 0, insufficient: lot.insufficient ?? false }
    cur.qty += lot.to_withdraw
    map.set(key, cur)
  }
  return Array.from(map.entries()).map(([k, v]) => ({
    date: k === '__i__' ? 'ไม่เพียงพอ' : k,
    ...v,
  }))
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

const roundTo5Or0 = (qty: number): number => {
  if (qty <= 0) return 0
  const rounded = Math.round(qty / 5) * 5
  return rounded === 0 ? 5 : rounded
}

export async function downloadWithdrawalPDF(params: {
  date: string
  phase: string
  rounds: string[]
  items: ItemData[]
  cfg: CfgData
  basketMap?: Map<string, number>
}) {
  const { date, phase, rounds, items, cfg, basketMap } = params

  const getBaskets = (sku: string, qty: number): number | null => {
    if (!basketMap) return null
    const rate = basketMap.get(String(sku).replace(/^0+/, '').trim())
    if (!rate || rate <= 0) return null
    return Math.ceil(qty / rate)
  }

  const getTotalBaskets = (item: ItemData): number | null => {
    if (!item.lots?.length) return getBaskets(item.sku, item.quantity)
    const byDate = new Map<string, number>()
    for (const lot of item.lots) {
      if (lot.insufficient) continue
      byDate.set(lot.prod_date, (byDate.get(lot.prod_date) ?? 0) + lot.to_withdraw)
    }
    if (!byDate.size) return null
    let total = 0
    for (const qty of Array.from(byDate.values())) {
      const b = getBaskets(item.sku, qty)
      if (b == null) return null
      total += b
    }
    return total
  }
  const accent = PHASE_COLOR[cfg.color] ?? [55, 65, 81]
  const doc = new jsPDF({ format: 'a4', unit: 'mm', orientation: 'portrait' })

  await loadFonts(doc)
  doc.setFont('Sarabun', 'normal')

  const now = new Date()
  const printTime = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} น.`

  const pageW = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = margin

  // ─── Document header ───────────────────────────────────────────────────────
  doc.setFont('Sarabun', 'bold')
  doc.setFontSize(14)
  doc.text(`ใบเบิกสินค้า — ${cfg.label}`, margin, y)
  doc.setFont('Sarabun', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(107, 114, 128)
  doc.text(`วันที่ผลิต: ${date}  ·  เวลา: ${cfg.time}`, margin, y + 6)
  doc.text(`พิมพ์เมื่อ: ${printTime}`, pageW - margin, y + 6, { align: 'right' })
  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(17, 24, 39)
  doc.setLineWidth(0.5)
  doc.line(margin, y + 9, pageW - margin, y + 9)
  y += 15

  // ─── Rounds ────────────────────────────────────────────────────────────────
  for (let ri = 0; ri < rounds.length; ri++) {
    const roundTime = rounds[ri]
    const roundItems = items.filter(item =>
      item.withdrawal_round ? item.withdrawal_round === roundTime : ri === 0
    )
    if (!roundItems.length) continue

    // Round header bar
    doc.setFillColor(...accent)
    doc.roundedRect(margin, y, pageW - margin * 2, 7, 1, 1, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('Sarabun', 'bold')
    doc.setFontSize(10)
    doc.text(`รอบ ${roundTime} น.`, margin + 4, y + 5)
    doc.setTextColor(0, 0, 0)
    y += 10

    // Group by station
    const grouped = roundItems.reduce<Record<string, ItemData[]>>((acc, item) => {
      const k = item.work_station ?? 'ไม่ระบุ'
      ;(acc[k] ??= []).push(item)
      return acc
    }, {})

    for (const [station, stItems] of Object.entries(grouped)) {
      // Station label
      doc.setFont('Sarabun', 'bold')
      doc.setFontSize(9)
      doc.setFillColor(243, 244, 246)
      doc.roundedRect(margin, y, pageW - margin * 2, 6, 1, 1, 'F')
      doc.text(STATION_DISPLAY[station] ?? station, margin + 3, y + 4.2)
      doc.setFont('Sarabun', 'normal')
      y += 8

      // Build table rows
      const bodyRows: (string | { content: string; styles: object })[][] = []
      stItems.forEach((item, idx) => {
        const b = getTotalBaskets(item)
        bodyRows.push([
          String(idx + 1),
          item.sku,
          item.sku_name ?? '-',
          fmt(roundTo5Or0(item.quantity)),
          item.unit,
          b != null ? `${b}` : '',
        ])
        if (item.lots?.length) {
          for (const { date: ld, qty, insufficient } of groupLots(item.lots)) {
            const lb = !insufficient ? getBaskets(item.sku, qty) : null
            const bg: [number, number, number] = insufficient ? [254, 242, 242] : [239, 246, 255]
            bodyRows.push([
              '',
              {
                content: insufficient ? `⚠ ${ld}` : `ผลิต ${ld}`,
                styles: { textColor: insufficient ? [220, 38, 38] : [37, 99, 235], fillColor: bg },
              },
              '',
              {
                content: fmt(roundTo5Or0(qty)),
                styles: { textColor: insufficient ? [220, 38, 38] : [29, 78, 216], fontStyle: 'bold', fillColor: bg },
              },
              { content: 'กก.', styles: { fillColor: bg } },
              {
                content: lb != null ? `${lb}` : '',
                styles: { textColor: [234, 88, 12], fillColor: bg },
              },
            ])
          }
        }
      })

      const stTotal = stItems.reduce((s, i) => s + roundTo5Or0(i.quantity), 0)
      bodyRows.push([
        '', '', { content: 'รวม', styles: { halign: 'right', fontStyle: 'bold', fillColor: [243, 244, 246] } },
        { content: fmt(stTotal), styles: { fontStyle: 'bold', fillColor: [243, 244, 246] } },
        { content: 'กก.', styles: { fillColor: [243, 244, 246] } },
        '',
      ])

      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['#', 'รหัส', 'ชื่อสินค้า / วัตถุดิบ', 'จำนวน', 'หน่วย', 'ตะกร้า']],
        body: bodyRows,
        theme: 'plain',
        styles: { font: 'Sarabun', fontSize: 8.5, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [249, 250, 251], textColor: [55, 65, 81], lineWidth: 0.2, lineColor: [209, 213, 219] },
        bodyStyles: { lineWidth: 0.15, lineColor: [229, 231, 235] },
        columnStyles: {
          0: { cellWidth: 8,  halign: 'center', textColor: [156, 163, 175] },
          1: { cellWidth: 24, font: 'Sarabun' },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
          4: { cellWidth: 12, textColor: [107, 114, 128] },
          5: { cellWidth: 18, halign: 'right', textColor: [234, 88, 12] },
        },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const cell = bodyRows[data.row.index]?.[data.column.index]
            if (cell && typeof cell === 'object' && 'styles' in cell) {
              Object.assign(data.cell.styles, cell.styles)
            }
          }
        },
      })

      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
    }

    y += 4
  }

  // ─── Signatures ────────────────────────────────────────────────────────────
  const sigY = Math.min(y + 8, doc.internal.pageSize.getHeight() - 40)
  doc.setDrawColor(156, 163, 175)
  doc.setLineWidth(0.3)
  doc.line(margin, sigY, pageW - margin, sigY)

  const roles = ['ผู้เบิก', 'ผู้จ่ายของ']
  const sigW = (pageW - margin * 2) / 2
  roles.forEach((role, i) => {
    const cx = margin + sigW * i + sigW / 2
    const lineY = sigY + 22
    doc.line(margin + sigW * i + 10, lineY, margin + sigW * (i + 1) - 10, lineY)
    doc.setFont('Sarabun', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(107, 114, 128)
    doc.text(role, cx, lineY + 5, { align: 'center' })
    doc.setFontSize(7)
    doc.setTextColor(156, 163, 175)
    doc.text('วันที่ ......../......../.........',  cx, lineY + 10, { align: 'center' })
  })

  doc.save(`ใบเบิก-Phase${phase}-${date}.pdf`)
}
