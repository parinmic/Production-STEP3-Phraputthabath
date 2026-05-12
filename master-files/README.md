# Master Files

วางไฟล์ Excel ต้นฉบับสำหรับ upload เข้าระบบที่นี่

## โครงสร้าง Folder

```
master-files/
├── bom/                 ← BOM: ไฟล์ mapping SKU → Raw Material
├── master-logic/        ← Master Logic Calculation & Manpower
└── sku-master/          ← SKU Master (รายชื่อสินค้าและ Station)
```

## วิธีใช้

1. วางไฟล์ `.xlsx` ลงใน folder ที่ตรงกับประเภท
2. `git add` และ `git commit` เพื่อบันทึกเวอร์ชัน
3. นำไฟล์ไป upload ผ่านหน้าเว็บในระบบ
