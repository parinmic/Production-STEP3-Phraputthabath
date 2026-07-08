'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, BookOpen, ChevronRight, Upload, Download, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const SLIDE_BUCKET = 'manual-slides'
const SLIDE_FOLDER = 'slide'

export interface ManualItem {
  key: string
  label: string
  href?: string
  icon: LucideIcon
  summary: string
  body: string[]
  bullets?: string[]
  image?: string
  imageCaption?: string
}

export interface ManualGroup {
  heading: string
  items: ManualItem[]
}

export interface ManualStep {
  title: string
  description: string
  hint?: string
}

export interface ManualOverview {
  description: string
  steps: ManualStep[]
  notes?: string[]
}

export default function ManualLayout({
  title, subtitle, groups, overview,
}: {
  title: string
  subtitle: string
  groups: ManualGroup[]
  overview: ManualOverview
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>('__overview__')
  const [slideFile, setSlideFile] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.storage.from(SLIDE_BUCKET).list(SLIDE_FOLDER).then(({ data }) => {
      setSlideFile(data?.[0]?.name ?? null)
    })
  }, [])

  async function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      alert('อัปโหลดได้เฉพาะไฟล์ PDF เท่านั้น')
      return
    }
    setUploading(true)
    try {
      const { data: existing } = await supabase.storage.from(SLIDE_BUCKET).list(SLIDE_FOLDER)
      if (existing?.length) {
        await supabase.storage.from(SLIDE_BUCKET).remove(existing.map(f => `${SLIDE_FOLDER}/${f.name}`))
      }
      const { error } = await supabase.storage.from(SLIDE_BUCKET).upload(`${SLIDE_FOLDER}/${file.name}`, file, { upsert: true })
      if (error) throw error
      setSlideFile(file.name)
      alert('อัปโหลด PDF เรียบร้อยแล้ว')
    } catch (err) {
      alert('อัปโหลดไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setUploading(false)
    }
  }

  function handleDownload() {
    if (!slideFile) return
    const { data } = supabase.storage.from(SLIDE_BUCKET).getPublicUrl(`${SLIDE_FOLDER}/${slideFile}`)
    const a = document.createElement('a')
    a.href = data.publicUrl
    a.download = slideFile
    a.click()
  }

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map(g => ({ ...g, items: g.items.filter(i => `${i.label} ${i.summary} ${i.href ?? ''}`.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0)
  }, [query, groups])

  const activeItem = groups.flatMap(g => g.items).find(i => i.key === selected)

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-gray-500 mt-1 text-sm">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleUploadChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            อัปโหลด PDF คู่มือ
          </button>
          <button
            onClick={handleDownload}
            disabled={!slideFile}
            title={slideFile ?? 'ยังไม่มี PDF'}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            ดาวน์โหลด PDF คู่มือ
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left: search + feature list */}
        <aside className="w-full md:w-72 shrink-0 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ค้นหาคำสำคัญ เช่น อัพโหลด, กะ, กำลังคน"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setSelected('__overview__')}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-left transition-colors ${
                selected === '__overview__' ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <BookOpen size={16} className="shrink-0" />
              ภาพรวม — เริ่มต้นใช้งาน
            </button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto space-y-3 pr-1">
            {filteredGroups.map(g => (
              <div key={g.heading}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 px-1 mb-1">{g.heading}</p>
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  {g.items.map(item => (
                    <button
                      key={item.key}
                      onClick={() => setSelected(item.key)}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left border-t first:border-t-0 border-gray-100 transition-colors ${
                        selected === item.key ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <item.icon size={16} className="shrink-0" />
                      <span className="flex-1">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {query.trim() && filteredGroups.length === 0 && (
              <p className="text-sm text-gray-400 px-2 py-4 text-center">ไม่พบเมนูที่ตรงกับ &quot;{query}&quot;</p>
            )}
          </div>
        </aside>

        {/* Right: content */}
        <div className="flex-1 min-w-0">
          {selected === '__overview__' ? (
            <OverviewPanel overview={overview} />
          ) : activeItem ? (
            <ItemPanel item={activeItem} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function OverviewPanel({ overview }: { overview: ManualOverview }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="bg-emerald-50 text-emerald-600 rounded-lg p-2 shrink-0">
          <BookOpen size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">เริ่มต้นใช้งาน — ลำดับที่ควรทำ</h2>
          <p className="text-sm text-gray-500 mt-1">{overview.description}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-3">
        {overview.steps.map((step, i) => (
          <div key={step.title} className="flex items-stretch gap-3">
            <div className="w-44 bg-gray-50 border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex items-center justify-center">
                {i + 1}
              </div>
              <p className="font-semibold text-gray-800 text-sm">{step.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{step.description}</p>
              {step.hint && <p className="text-[11px] text-blue-600 font-medium mt-auto">{step.hint}</p>}
            </div>
            {i < overview.steps.length - 1 && (
              <div className="hidden md:flex items-center text-gray-300">
                <ChevronRight size={20} />
              </div>
            )}
          </div>
        ))}
      </div>

      {overview.notes?.length ? (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-1.5">
          <p className="text-sm font-medium text-blue-800">เพิ่มเติม</p>
          {overview.notes.map((n, i) => (
            <p key={i} className="text-sm text-blue-700 leading-relaxed">• {n}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ItemPanel({ item }: { item: ManualItem }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="bg-blue-50 text-blue-600 rounded-lg p-2 shrink-0">
          <item.icon size={20} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{item.label}</h2>
          <p className="text-sm text-gray-500 mt-1">{item.summary}</p>
        </div>
      </div>

      {item.image && (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.image} alt={`ตัวอย่างหน้าจอ ${item.label}`} className="w-full h-auto block" />
          <p className="text-xs text-gray-400 text-center py-1.5 bg-white border-t border-gray-100">
            {item.imageCaption ?? 'ตัวอย่างหน้าจอ'}
          </p>
        </div>
      )}

      <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
        {item.body.map((p, i) => <p key={i}>{p}</p>)}
      </div>

      {item.bullets?.length ? (
        <ul className="space-y-1.5 text-sm text-gray-700">
          {item.bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-blue-500 shrink-0">•</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {item.href && (
        <a
          href={item.href}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          ไปที่หน้านี้ <ChevronRight size={14} />
        </a>
      )}
    </div>
  )
}
