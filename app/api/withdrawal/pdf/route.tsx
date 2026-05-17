import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'
import path from 'path'

export const runtime = 'nodejs'

Font.register({
  family: 'Sarabun',
  fonts: [
    { src: path.join(process.cwd(), 'public/fonts/Sarabun-Regular.ttf'), fontWeight: 400 },
    { src: path.join(process.cwd(), 'public/fonts/Sarabun-Bold.ttf'),    fontWeight: 700 },
  ],
})

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
}
const PHASE_COLOR: Record<string, string> = {
  blue:   '#2563eb',
  orange: '#f97316',
  purple: '#9333ea',
}

const s = StyleSheet.create({
  page:       { fontFamily: 'Sarabun', fontSize: 9, padding: 22, color: '#111827' },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
                borderBottomWidth: 2, borderBottomColor: '#111827', paddingBottom: 6, marginBottom: 12 },
  docTitle:   { fontSize: 13, fontWeight: 700 },
  docSub:     { fontSize: 8, color: '#6b7280', marginTop: 3 },
  docRight:   { fontSize: 8, color: '#6b7280', textAlign: 'right', marginTop: 4 },
  roundBlock: { marginBottom: 12 },
  roundBar:   { flexDirection: 'row', alignItems: 'center', padding: '5 8', borderRadius: 4, marginBottom: 6 },
  roundTxt:   { color: '#fff', fontWeight: 700, fontSize: 10 },
  stnLabel:   { fontSize: 8, fontWeight: 700, color: '#374151', backgroundColor: '#f3f4f6',
                padding: '3 6', borderRadius: 3, marginBottom: 3 },
  tHead:      { flexDirection: 'row', backgroundColor: '#f9fafb',
                borderBottomWidth: 1, borderBottomColor: '#d1d5db', paddingVertical: 3 },
  tRow:       { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 3 },
  lotRow:     { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#dbeafe',
                backgroundColor: '#eff6ff', paddingVertical: 2 },
  badRow:     { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#fecaca',
                backgroundColor: '#fef2f2', paddingVertical: 2 },
  totRow:     { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 3, marginTop: 1 },
  cNum:  { width: '5%',  paddingHorizontal: 3, color: '#9ca3af' },
  cSku:  { width: '13%', paddingHorizontal: 3 },
  cName: { flex: 1,      paddingHorizontal: 3 },
  cQty:  { width: '12%', paddingHorizontal: 3, textAlign: 'right' },
  cUnit: { width: '7%',  paddingHorizontal: 3, color: '#6b7280' },
  cNote: { width: '20%', paddingHorizontal: 3, color: '#9ca3af' },
  thTxt: { fontSize: 8, color: '#374151', fontWeight: 700 },
  sigArea: { flexDirection: 'row', justifyContent: 'space-between',
             marginTop: 24, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#d1d5db' },
  sigBox:  { width: '30%', alignItems: 'center' },
  sigLine: { width: '100%', borderBottomWidth: 1, borderBottomColor: '#9ca3af', paddingBottom: 22, marginBottom: 4 },
  sigRole: { fontSize: 8, color: '#6b7280' },
  sigDate: { fontSize: 7, color: '#9ca3af', marginTop: 2 },
})

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

function groupLots(lots: LotInfo[]) {
  const map = new Map<string, { qty: number; insufficient: boolean }>()
  for (const lot of lots) {
    const key = lot.insufficient ? '__i__' : lot.prod_date
    const cur = map.get(key) ?? { qty: 0, insufficient: lot.insufficient ?? false }
    cur.qty += lot.to_withdraw
    map.set(key, cur)
  }
  return Array.from(map.entries()).map(([k, v]) => ({ date: k === '__i__' ? 'ไม่เพียงพอ' : k, ...v }))
}

function StationTable({ items }: { items: ItemData[] }) {
  const total = items.reduce((s, i) => s + i.quantity, 0)
  return (
    <View>
      <View style={s.tHead}>
        <Text style={[s.cNum,  s.thTxt]}>#</Text>
        <Text style={[s.cSku,  s.thTxt]}>รหัส</Text>
        <Text style={[s.cName, s.thTxt]}>ชื่อสินค้า / วัตถุดิบ</Text>
        <Text style={[s.cQty,  s.thTxt]}>จำนวน</Text>
        <Text style={[s.cUnit, s.thTxt]}>หน่วย</Text>
        <Text style={[s.cNote, s.thTxt]}>หมายเหตุ</Text>
      </View>

      {items.map((item, idx) => {
        const lotGroups = item.lots ? groupLots(item.lots) : []
        return (
          <View key={`${item.sku}-${idx}`}>
            <View style={s.tRow}>
              <Text style={[s.cNum]}>{idx + 1}</Text>
              <Text style={[s.cSku]}>{item.sku}</Text>
              <Text style={[s.cName]}>{item.sku_name ?? '-'}</Text>
              <Text style={[s.cQty,  { fontWeight: 700 }]}>{fmt(item.quantity)}</Text>
              <Text style={[s.cUnit]}>{item.unit}</Text>
              <Text style={[s.cNote]}>{item.note ?? ''}</Text>
            </View>
            {lotGroups.map(({ date, qty, insufficient }) => (
              <View key={`l-${date}`} style={insufficient ? s.badRow : s.lotRow}>
                <Text style={s.cNum} />
                <Text style={[s.cSku, { fontSize: 8, color: insufficient ? '#dc2626' : '#2563eb' }]}>
                  {insufficient ? `⚠ ${date}` : `ผลิต ${date}`}
                </Text>
                <Text style={s.cName} />
                <Text style={[s.cQty, { fontSize: 8, fontWeight: 700, color: insufficient ? '#dc2626' : '#1d4ed8' }]}>
                  {fmt(qty)}
                </Text>
                <Text style={[s.cUnit, { fontSize: 8 }]}>กก.</Text>
                <Text style={s.cNote} />
              </View>
            ))}
          </View>
        )
      })}

      <View style={s.totRow}>
        <Text style={s.cNum} />
        <Text style={s.cSku} />
        <Text style={[s.cName, { textAlign: 'right', fontWeight: 700, color: '#374151', fontSize: 8 }]}>รวม</Text>
        <Text style={[s.cQty,  { fontWeight: 700 }]}>{fmt(total)}</Text>
        <Text style={s.cUnit}>กก.</Text>
        <Text style={s.cNote} />
      </View>
    </View>
  )
}

function WithdrawalDoc({ date, phase, rounds, items, cfg }: {
  date: string; phase: string; rounds: string[]; items: ItemData[]; cfg: CfgData
}) {
  const accent = PHASE_COLOR[cfg.color] ?? '#374151'
  const now = new Date()
  const printTime = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} น.`

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.pageHeader}>
          <View>
            <Text style={s.docTitle}>ใบเบิกสินค้า — {cfg.label}</Text>
            <Text style={s.docSub}>วันที่ผลิต: {date} · เวลา: {cfg.time}</Text>
          </View>
          <Text style={s.docRight}>พิมพ์เมื่อ: {printTime}</Text>
        </View>

        {/* Rounds */}
        {rounds.map((roundTime, roundIdx) => {
          const roundItems = items.filter(item =>
            item.withdrawal_round ? item.withdrawal_round === roundTime : roundIdx === 0
          )
          if (!roundItems.length) return null

          const grouped = roundItems.reduce<Record<string, ItemData[]>>((acc, item) => {
            const k = item.work_station ?? 'ไม่ระบุ'
            ;(acc[k] ??= []).push(item)
            return acc
          }, {})

          return (
            <View key={roundTime} style={s.roundBlock}>
              <View style={[s.roundBar, { backgroundColor: accent }]}>
                <Text style={s.roundTxt}>รอบ {roundTime} น.</Text>
              </View>
              {Object.entries(grouped).map(([station, stItems]) => (
                <View key={station} style={{ marginBottom: 6 }}>
                  <Text style={s.stnLabel}>{STATION_DISPLAY[station] ?? station}</Text>
                  <StationTable items={stItems} />
                </View>
              ))}
            </View>
          )
        })}

        {/* Signatures */}
        <View style={s.sigArea}>
          {['ผู้เบิก', 'ผู้จ่ายของ', 'ผู้อนุมัติ'].map(role => (
            <View key={role} style={s.sigBox}>
              <View style={s.sigLine} />
              <Text style={s.sigRole}>{role}</Text>
              <Text style={s.sigDate}>วันที่ ......../......../.........</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { date, phase, rounds, items, cfg } = body as {
      date: string; phase: string; rounds: string[]; items: ItemData[]; cfg: CfgData
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(
      React.createElement(WithdrawalDoc, { date, phase, rounds, items, cfg }) as any
    )

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="withdrawal-phase${phase}-${date}.pdf"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 })
  }
}
