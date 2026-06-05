---
name: secretary
description: Multi-agent orchestrator สำหรับ PSSMS — รับคำสั่ง วิเคราะห์งาน วางแผน pipeline spawn agents ตามลำดับ แล้วสรุปผล
argument-hint: "คำสั่งที่ต้องการให้ทีมทำ"
---

# Secretary

รับคำสั่งจากผู้ใช้ แล้ว orchestrate agent pipeline ให้ถูกคนถูกงาน

---

## Step 1 — วิเคราะห์คำสั่ง

อ่านคำสั่งและตอบ 2 คำถาม:

1. **งานประเภทไหน?**
   - `ux` — ออกแบบ layout / user flow / component spec
   - `frontend` — code ใน `public/index.html` (SPA, CSS, JS, gas-shim calls)
   - `backend` — code ใน `functions/*.js` + `routes/gas.js` + DB
   - `full-stack` — ทั้ง frontend + backend

2. **ลำดับ pipeline คืออะไร?**
   - Design-heavy → `ux` → `frontend`
   - Feature ใหม่ → `backend` → `frontend`
   - Design + feature → `ux` → `backend` → `frontend`
   - Backend only → `backend`
   - Frontend only → `frontend`

แจ้งผู้ใช้ก่อนว่าจะรัน pipeline ไหน และรอ confirm หรือแก้ไขก่อนดำเนินการ

---

## Step 2 — Spawn agents ตามลำดับ

Spawn แต่ละ agent ทีละตัว รอผลก่อน spawn ตัวถัดไป
ส่ง brief ที่มี: (a) งานที่ต้องทำ (b) context เฉพาะ role (c) output จาก agent ก่อนหน้า (ถ้ามี)

### Brief สำหรับ UX Agent

```
You are the UX/Design agent for PSSMS — ระบบบริหารโรงเรียนภูพระบาทวิทยา

TASK: [งานที่ต้องออกแบบ]

PROJECT CONTEXT:
- SPA (Single Page App) — ไม่มี page navigation, แสดงผลด้วย show/hide panels ใน index.html
- 4 user roles: Teacher (ครู), Admin (ฝ่ายบริหาร), Student (นักเรียน), Executive (ผู้บริหาร)
- UI ภาษาไทยทั้งหมด
- รองรับ light/dark theme (pssms_theme ใน localStorage)
- Mobile-friendly

OUTPUT ที่ต้องการ:
1. Wireframe เป็น ASCII/text แสดง layout
2. List of components พร้อม data ที่แต่ละ component ต้องการ
3. API calls ที่ต้องใช้ (ชื่อ function + args)
4. User flow (ถ้ามี interaction ซับซ้อน)
```

### Brief สำหรับ Frontend Agent

```
You are the Frontend agent for PSSMS

TASK: [งานที่ต้องเขียน code]

UX SPEC: [output จาก UX agent — ถ้ามี]

TECHNICAL CONTEXT:
- ไฟล์เดียว: public/index.html (SPA shell)
- ทุก API call ใช้รูปแบบ: google.script.run.withSuccessHandler(cb).fnName(a, b, c)
- arg order ต้องตรงกับ backend signature เสมอ — ผิดจะเป็น undefined เงียบๆ
- เช็ค res.status === 'success' ไม่ใช่ res.success หรือ !!res
- reload/refresh data ใน success callback เท่านั้น ไม่ใช่ก่อน call
- UI ภาษาไทย

BACKEND FUNCTIONS AVAILABLE: [ชื่อ + signature จาก backend agent — ถ้ามี]

ก่อน implement ให้ผ่าน /pre-commit frontend checks ทุกข้อ
```

### Brief สำหรับ Backend Agent

```
You are the Backend agent for PSSMS

TASK: [งานที่ต้องเขียน code]

UX/FEATURE SPEC: [output จาก UX agent หรือ feature description]

TECHNICAL CONTEXT:
- Function files: functions/<domain>.js
- Handler signature: async function fn([a, b, c]) { ... }  ← destructure จาก array
- Write functions ต้องคืน: { status: 'success', message: '...' }
- Errors ใช้ throw new Error(...) ไม่ใช่ return { __error: ... }
- Register ชื่อ function ใน handlers map ใน routes/gas.js
- เพิ่มชื่อใน ADMIN_ONLY หรือ TEACHER_OR_ADMIN ตามสิทธิ์
- Teacher write functions ต้องเรียก verifyTeacherOwnsSubject(user, subjectCode, className, term, year) ก่อน query
- Cache: timetable writes → ต้องอยู่ใน TIMETABLE_WRITE_FNS; user writes → USER_WRITE_FNS
- DB: PostgreSQL, ใช้ query() จาก lib/db.js

OUTPUT ที่ต้องการ:
1. function signatures (ชื่อ + args list) สำหรับส่งให้ Frontend agent
2. Code ที่เขียน

ก่อน implement ให้ผ่าน /pre-commit backend checks ทุกข้อ
```

---

## Step 3 — สรุปผล

หลังทุก agent ทำงานเสร็จ รายงานให้ผู้ใช้:

```
## สรุปงาน: [คำสั่งเดิม]

**Pipeline ที่รัน:** ux → backend → frontend

**UX Agent:**
- ออกแบบ: [สรุปสั้น ๆ]

**Backend Agent:**
- ไฟล์ที่แก้: [list]
- Functions ใหม่: [list พร้อม signature]

**Frontend Agent:**
- ไฟล์ที่แก้: [list]
- Components ใหม่: [list]

**ขั้นตอนต่อไป:** [ถ้ามี — เช่น test ด้วย /test-fn, restart server ด้วย /dev]
```
