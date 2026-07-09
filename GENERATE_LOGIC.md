# Logic การสร้างแผนผลิต (Generate)

> ไฟล์นี้อธิบาย logic ทั้งหมดของ `app/api/production/generate/route.ts`

---

## 1. Phase Configuration

| Phase | Period | เวลา | ข้อมูล Workforce |
|-------|--------|------|-----------------|
| 1 | เช้า | 08:30 – 14:00 | อัพโหลดรอบ 08:00 |
| 2 | บ่าย | 14:00 – 16:00 | อัพโหลดรอบ 13:00 (override 08:00) |
| 3 | ค่ำ | 16:00 – 07:00 (วันถัดไป) | อัพโหลดรอบ 13:00 (override 08:00) |

**Shift cap:**
- กะ 1 → ทำได้ถึง 17:00 (Phase 1/2) หรือจนจบ Phase 3
- กะ 2 / กะ 3 → ทำได้ถึง 07:00 ของวันถัดไป (ต้องจบ Phase 3 ไม่เกินเวลานี้)

**Break (หักออกจากเวลาทำงาน):**
- 12:00 – 13:00
- 17:00 – 18:00

---

## 2. แหล่งข้อมูลแต่ละ Phase

### Phase 1 (เช้า)
| Channel | แหล่งข้อมูล Target |
|---------|-------------------|
| Wet Market | เฉลี่ย BL3 (3 วันย้อนหลัง รอบ 16:00) × %Variance |
| LOTUS | เฉลี่ย BL3 รอบ 16:00 (fallback: Order วันนี้รอบ 14:00 ถ้าไม่มี BL3) |
| Makro | Order วันนี้รอบ 08:00 × %Variance |

> SKU ที่มี Makro order วันนี้ → ข้าม Wet Market / LOTUS สำหรับ SKU นั้น

### Phase 2 (บ่าย)
| Channel | แหล่งข้อมูล Target |
|---------|-------------------|
| Wet Market | Order วันนี้รอบ 14:00 − ยอดที่ผลิตใน Phase 1 |
| LOTUS | Order วันนี้รอบ 14:00 − ยอดที่ผลิตใน Phase 1 |
| Makro | Order วันนี้รอบ 14:00 − ยอดที่ผลิตใน Phase 1 |

**3 โหมดหักลบ (เลือกตอนกด Generate):**
- `plan` — หักจากยอดที่วางแผนไว้ใน Phase 1 ทั้งหมด
- `actual` — หักเฉพาะงานที่ status = เสร็จแล้ว
- `yield` — หักจากยอด "รับผลได้" (ถุง × น้ำหนักต่อถุง)

### Phase 3 (ค่ำ)
- ใช้ **แผนผลิต 100%** (`production_plan_100`) เป็นยอดทั้งหมด
- หักด้วยยอดที่ผลิตไปแล้วใน Phase 1 + Phase 2 (รวมทุก channel)
- ลำดับ channel ตาม Mas Channel → SKU ที่ไม่อยู่ใน Phase 1 ใช้ channel = `plan100`

---

## 3. การคำนวณ %Variance

### Wet Market
```
isShared = SKU นี้มีใน LOTUS BL3 ด้วยไหม?

ถ้า NOT shared:
  min(quota, avgBL3) > 100 กก. → 50%
  อื่นๆ                        → 30%

ถ้า shared:
  ratio = min(quota, avgBL3) / lotusBL3
  ratio > 0.5 → 50%
  อื่นๆ       → 70%
```

### Makro
```
trend = orderQty / avgBL3

trend > 1.0 → 100%
trend > 0.8 → 80%
อื่นๆ + proportion > 10% ของ total → 60%
อื่นๆ                               → 40%
```

---

## 4. ลำดับ Priority SKU (Mas Channel)

Order ที่จัด SKU ก่อนหลังเวลา assign worker:
1. เรียงตาม Channel Priority (Mas Channel master)
2. ภายใน channel เดียวกัน → เรียงตาม target_quantity มากไปน้อย

ถ้าไม่มี Mas Channel → default: Wet Market → Makro → LOTUS

---

## 5. การปัดปริมาณขึ้นถุง

ก่อน assign ทุก SKU จะปัด target_qty ขึ้นเป็นจำนวนเต็มถุงเสมอ:
```
target = ceil(qty / weight_per_bag) × weight_per_bag
```
ดึงจาก `picking_unit_master` — ถ้าไม่มีข้อมูลถุง ใช้ qty เดิม

---

## 6. การ Assign Worker (assignWorkers)

### หลักการ
Worker ที่ว่างก่อนจะได้รับงานก่อน แบ่งงานตามสัดส่วนเวลาที่มี

### ขั้นตอน
1. **กรอง Worker** ที่อยู่ถูก Station และมีทักษะตรงกับ product_group ของ SKU
2. **เรียงลำดับ** ตาม skill level (Mas Job Assign: 1 = ดีเยี่ยม, 2 = รองลงมา) → เหลือ hours มากกว่าได้ก่อน
3. **จำกัดจำนวน Worker** ตาม qty:
   - ≤ 15 กก. → 1 คน
   - ≤ 30 กก. → 2 คน
   - ≤ 45 กก. → 3 คน
   - > 45 กก. → ไม่จำกัด

4. **Dynamic queue** แบ่งเป็น segment ตาม event times (worker เข้า/ออก, break, round boundaries):
   ```
   pool = targetQty
   for each segment [t0, t1]:
     skip ถ้าอยู่ใน break
     active = workers ที่ว่างในช่วงนี้
     maxConsume = totalRate × duration
     
     ถ้า maxConsume >= pool:
       แบ่ง pool เท่าๆ กันทุกคน → finish ก่อนครบ segment
     ถ้า maxConsume < pool:
       ทุกคนทำเต็ม segment → pool -= maxConsume
   ```

5. **อัพเดทสถานะ Worker** หลัง assign:
   - `workerHours` ลดลง = qty / rate
   - `workerFreeAtMins` เลื่อนไปถึงเวลา finish

6. **บันทึก per-round qty** ลงใน `note` field:
   ```
   rounds:510=575;600=575
   ```
   → round 08:30 ผลิต 575 กก., round 10:00 ผลิต 575 กก.

---

## 7. แผนเสริม (Supplementary Plan)

ก่อน assign งานปกติ ระบบทำ **2 Pass**:

### Pass 1 — Supplementary (งานเร่งด่วน)
- ดึงแผนเสริม slot 1/2/3 ที่มี deadline อยู่ในช่วง phase นี้
- เรียง slot ตาม deadline เร็วสุดก่อน
- assign worker โดยใช้ `phaseEndMins = deadline ของ slot นั้น` (ต้องเสร็จก่อนเวลาโหลดจ่าย)
- `channel = 'เสริม'` → แสดงสีทอง

### Pass 2 — ปกติ
- Worker ที่เหลือ + เวลาที่เหลือหลัง Pass 1 → assign งานปกติตาม assignList

> Worker state (`workerHours`, `workerFreeAtMins`) ส่งต่อระหว่าง Pass 1 และ Pass 2 เสมอ

---

## 8. Mid-Phase Regen (Generate กลางคัน)

เมื่อกด Generate ขณะที่ phase กำลังดำเนินอยู่:

### คำนวณ Freeze Point
```
nowMins = เวลาปัจจุบัน (TH UTC+7) เป็นนาทีนับจากเที่ยงคืน

ถ้า nowMins % 30 === 0:
  freezePoint = nowMins + 30    ← ตรง :00/:30 พอดี → กระโดดไปอีกครึ่งชม
ถ้าไม่ใช่:
  freezePoint = ceil(nowMins / 30) × 30

freezePoint = max(phaseStart, min(freezePoint, phaseEnd))
```

**ตัวอย่าง:**
| เวลาปัจจุบัน | Freeze Point |
|-------------|-------------|
| 8:40 | 9:00 |
| 8:30 | 9:00 |
| 9:00 | 9:30 |
| 14:15 | 14:30 |

### การจัดการ Database
```
ถ้า freezePoint > phaseStart (mid-phase):
  KEEP   → assignments ที่ deadline_time < freezePoint  (งานที่เริ่มแล้ว)
  DELETE → assignments ที่ deadline_time >= freezePoint (งานที่ยังไม่เริ่ม)
  INSERT → assignments ใหม่ตั้งแต่ freezePoint

ถ้า freezePoint = phaseStart (fresh generate):
  DELETE → ทั้งหมด
  INSERT → assignments ใหม่ตั้งแต่ phaseStart
```

### Worker Start Time
- **ทุก worker** เริ่มนับเวลาใหม่จาก `freezePoint` เท่ากันหมด
- `workerHours` = เวลาที่เหลือตั้งแต่ freezePoint ถึง shift end

---

## 9. Seq (ลำดับการแสดงผล)

- Fresh generate: `seq = 0, 1, 2, ...`
- Mid-phase regen: `seq = (maxSeqของที่เก็บ + 1), ...` เพื่อให้ assignments ใหม่ต่อท้ายของเดิม

---

## 10. ภาพรวม Flow ทั้งหมด

```
POST /api/production/generate
  │
  ├─ โหลดข้อมูลทั้งหมดพร้อมกัน (parallel)
  │   ├─ Workforce (0800 + 1300)
  │   ├─ Orders (WM, LOTUS, Makro) ทั้ง today + BL3
  │   ├─ Master: Productivity, Channel, Job Assign
  │   ├─ Previous assignments (Phase 2/3)
  │   ├─ Yield bags (yield mode)
  │   ├─ Plan 100% (Phase 3)
  │   └─ Picking unit master
  │
  ├─ คำนวณ Freeze Point (mid-phase regen)
  │
  ├─ กำหนด workerHours + workerFreeAtMins ทุกคน (เริ่มที่ freezePoint)
  │
  ├─ คำนวณ Target qty ต่อ SKU ต่อ Channel
  │   ├─ Phase 1: BL3 avg × %Variance
  │   ├─ Phase 2: Order − Phase1
  │   └─ Phase 3: Plan100 − Ph1 − Ph2
  │
  ├─ เรียง SKU ตาม Channel Priority → qty desc
  │
  ├─ Pass 1: Assign แผนเสริม (deadline cap)
  │
  ├─ Pass 2: Assign แผนปกติ (phaseEnd cap)
  │
  ├─ Delete assignments เก่า (ตาม freeze logic)
  │
  └─ Insert assignments ใหม่
```
