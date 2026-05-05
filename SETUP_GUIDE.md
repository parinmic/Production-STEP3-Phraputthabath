# คู่มือติดตั้งและ Deploy ระบบคำสั่งผลิต

## ภาพรวม
- **Frontend + Backend**: Next.js → deploy บน Vercel (ฟรี)
- **Database**: Supabase PostgreSQL (ฟรี)
- **ภาษา**: TypeScript (JavaScript)

---

## STEP 1 — ติดตั้ง Tools ที่จำเป็น

### 1.1 ติดตั้ง Node.js
1. ไปที่ https://nodejs.org
2. ดาวน์โหลด **LTS version** (ตัวเลขซ้าย)
3. ติดตั้งตามขั้นตอน (กด Next ไปเรื่อยๆ)
4. ตรวจสอบโดยเปิด Command Prompt แล้วพิมพ์:
   ```
   node --version
   ```
   ต้องแสดง v20.x.x หรือสูงกว่า

### 1.2 ติดตั้ง VS Code (แนะนำ)
1. ไปที่ https://code.visualstudio.com
2. ดาวน์โหลดและติดตั้ง
3. เปิดโฟลเดอร์ web-app ด้วย VS Code

---

## STEP 2 — สร้าง Account ที่จำเป็น

### 2.1 GitHub (สำหรับเก็บ Code)
1. ไปที่ https://github.com
2. สมัคร Account ฟรี
3. สร้าง Repository ใหม่ (ชื่อ: production-system)

### 2.2 Supabase (Database ฟรี)
1. ไปที่ https://supabase.com
2. กด "Start your project" → สมัคร Account
3. กด "New project"
4. กรอก:
   - Name: production-system
   - Database Password: ตั้งรหัสที่จำได้ (เก็บไว้)
   - Region: Southeast Asia (Singapore)
5. รอ ~2 นาที

### 2.3 Vercel (Deploy ฟรี)
1. ไปที่ https://vercel.com
2. สมัครด้วย GitHub Account

---

## STEP 3 — ตั้งค่า Supabase Database

1. เปิด Supabase Dashboard → เลือก Project ที่สร้าง
2. คลิก **SQL Editor** ในเมนูซ้าย
3. คลิก **New query**
4. เปิดไฟล์ `supabase-schema.sql` ในโฟลเดอร์นี้
5. Copy ทั้งหมด แล้ว Paste ใน SQL Editor
6. กด **Run** (หรือ Ctrl+Enter)
7. ต้องเห็นข้อความ "Success"

---

## STEP 4 — ตั้งค่า Environment Variables

1. ใน Supabase Dashboard → คลิก **Settings** → **API**
2. Copy ค่าสองตัวนี้:
   - **Project URL**: เช่น `https://abcdefgh.supabase.co`
   - **anon public key**: ยาวมาก ขึ้นต้นด้วย `eyJ...`

3. ในโฟลเดอร์ `web-app`:
   - Copy ไฟล์ `.env.local.example` → เปลี่ยนชื่อเป็น `.env.local`
   - เปิดไฟล์ `.env.local` แล้วใส่ค่า:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...ค่าที่ Copy มา...
   ```

---

## STEP 5 — ทดสอบ Run ใน Local

1. เปิด Command Prompt หรือ Terminal
2. ไปยังโฟลเดอร์ web-app:
   ```
   cd "C:\Users\parinya.the\OneDrive - Charoen Pokphand Foods Group\PLP - Process Improvement (Production)\3_Step 3\Production System\web-app"
   ```
3. ติดตั้ง dependencies:
   ```
   npm install
   ```
4. รันโปรแกรม:
   ```
   npm run dev
   ```
5. เปิด Browser ไปที่ http://localhost:3000
6. ต้องเห็นหน้าแรกของระบบ

---

## STEP 6 — Upload Code ไป GitHub

```
git init
git add .
git commit -m "Initial production system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/production-system.git
git push -u origin main
```

(แทนที่ YOUR_USERNAME ด้วยชื่อ GitHub ของคุณ)

---

## STEP 7 — Deploy ขึ้น Vercel

1. ไปที่ https://vercel.com/dashboard
2. กด **New Project**
3. เลือก Repository `production-system` จาก GitHub
4. กด **Import**
5. ใส่ Environment Variables:
   - กด **Environment Variables**
   - เพิ่ม:
     - `NEXT_PUBLIC_SUPABASE_URL` = URL จาก Supabase
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = Key จาก Supabase
6. กด **Deploy**
7. รอ 2-3 นาที
8. Vercel จะให้ URL เช่น `https://production-system-abc.vercel.app`

---

## วิธีใช้งานระบบ

### วันแรกของแต่ละวัน:
1. เข้าหน้า **กำลังคนประจำวัน** → อัพโหลด Excel พนักงานวันนี้
2. เข้าหน้า **คำสั่งซื้อ Makro** → อัพโหลดคำสั่งซื้อล่วงหน้า
3. เข้าหน้า **Quota ช่องทางขาย** → อัพโหลด Quota วันนี้
4. เข้าหน้า **คำสั่งผลิต** → กด "สร้างคำสั่งผลิตวันนี้"
5. เข้าหน้า **คำสั่งผลิตรายโต้ะ** เพื่อดูคำสั่งแต่ละโต้ะ

### Template ไฟล์ Excel:
- แต่ละหน้าอัพโหลดมีปุ่ม **ดาวน์โหลด Template** → ดาวน์โหลดแล้วกรอกข้อมูลตาม Format
- บันทึกเป็น .xlsx หรือ .csv

---

## แก้ไขสูตรคำนวณ

ไฟล์: `app/api/production/generate/route.ts`
ดูบรรทัดที่มีคอมเมนต์: `// สูตร (placeholder — แก้ไขตามจริง)`
แก้ไขตรงนั้นเมื่อได้สูตรที่แน่นอน

---

## โต้ะเพิ่มเติม

ถ้าต้องการเพิ่มโต้ะใหม่:
1. เพิ่มใน `components/Sidebar.tsx` → array `PRODUCTION_TABLES`
2. เพิ่มใน `app/production/[table]/page.tsx` → object `TABLE_CONFIG`
