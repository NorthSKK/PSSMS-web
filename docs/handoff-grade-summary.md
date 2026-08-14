# Handoff — การ์ด "นักเรียนกลุ่มเสี่ยง (0, ร, มส.)" ไม่ขึ้น

> ## ✅ ปิดงานแล้ว 2026-08-14 — เก็บไว้อ่านประวัติเท่านั้น
>
> ทุกข้อในเอกสารนี้ commit + push ขึ้น production แล้ว ไม่มีอะไรค้าง
>
> | งาน | commit |
> |---|---|
> | `gradeRecords` ตกหล่น + completeness gate | `cf13f52` |
> | ลบแถวค้างเมื่อยกเลิก remark | `9259a62` |
> | `missing.js` INNER JOIN + ห้องย้อนหลัง (ข้อ 1-2 ท้ายเอกสาร) | `369a1bb` |
> | cache key `grade_risk_v2_` → `v3_` | `cf13f52` |
>
> Backfill รันกับ production แล้ว (เขียน 1 แถว, ข้ามที่กรอกไม่ครบ 89 แถว)
>
> **สรุปที่ยังเป็นจริง:** การ์ดจะว่างจนกว่าจะมีคนกรอกคะแนนครบทั้งวิชา หรือครูตั้ง
> remark `ร`/`มส` — เป็นสถานะที่ถูกต้อง ไม่ใช่บั๊ก
>
> พฤติกรรมที่ยึดถือตอนนี้อยู่ใน `CLAUDE.md` หัวข้อ "Completeness gate" —
> ถ้าขัดกับเอกสารนี้ ให้ยึด `CLAUDE.md`

---

**Date:** 2026-08-13 (อัปเดตจาก 2026-08-11)
**Status (ณ ตอนเขียน):** code fix + completeness gate เสร็จแล้ว — ยัง**ไม่ commit/push**
รอ apply backfill (เขียนได้แค่ 1 แถวตอนนี้ ไม่เสี่ยง) แล้วดีพลอย

## อัปเดต 2026-08-13 — เจอปัญหาเพิ่ม: completeness gate

Dry-run รอบแรก (ไม่มี gate) ได้ 90/91 รายการ (98.9%) เข้าข่ายกลุ่มเสี่ยง — ผิดปกติมาก
ตรวจแล้วพบว่า**ทุกวิชากรอกคะแนนได้แค่ 30-60% ของ indicator ที่ควรมี** (เทอม
1/2569 ยังไม่จบเทอม) `calcRow()` ถือว่าช่องว่าง = 0 เสมอ (สำหรับ preview บนจอ)
รวมกับ autosave ทุก 3 วิ ทำให้ `gradeRecords` เขียนคะแนนไม่ครบเป็น grade=0
ปลอมของนักเรียนแทบทั้งหมด — ถ้า apply ตรง ๆ การ์ดจะเต็มไปด้วย false positive

**แก้แล้ว:** เพิ่ม completeness gate `_isGradeRowComplete()` ใน
`functions/scores.js` (เขียนได้เมื่อมี remark `ร`/`มส` ชัดเจน หรือทุก
formative+midterm+final ที่ ratio>0 มีคะแนนจริง) ใช้ gate เดียวกันใน
`db/backfill-grade-summary.js` — รายละเอียดสูตรอยู่ใน `CLAUDE.md` หัวข้อ
"Completeness gate"

**เช็คแล้ว: ไม่มี remark ร/มส ที่ตั้งไว้เลยในข้อมูลปัจจุบัน** (90 rows เป็น `-`
หมด) — หลัง gate แล้ว dry-run ได้แค่ **1 รายการ** (เกรด 4 ไม่เสี่ยง), ข้ามเพราะ
กรอกไม่ครบ 89, ไม่มี subject_config 1 (`SUBJ_FAKE` — แถวทดสอบ)
**การ์ดจะยังว่างเปล่าหลัง apply ก็ตาม — เป็นสถานะที่ถูกต้อง ไม่ใช่บั๊ก** จะเริ่ม
มีข้อมูลจริงเมื่อกรอกคะแนนครบวิชา/เทอม หรือครูตั้ง remark

เช็ค "รายงานสถิติเวลาเรียน (มส. 60-79%)" ด้วย (attendance-based, คนละ
data source กับ `grade_summary`) — เทส `getTeacherAtRiskDashboard` ตรงกับ
teacher ที่มีข้อมูล attendance จริง (teacher12) ได้ผล `risk:3` ไม่ error —
**ฟังก์ชันนี้ทำงานถูกต้อง** ถ้าเห็นว่างเปล่าเพราะ teacher account นั้นยังไม่มี
attendance log ในเทอมนั้น ไม่ใช่บั๊ก

`grade_risk_v2_` → bump เป็น `grade_risk_v3_` แล้วใน `Scripts_Teacher.html:484`
(กัน teacher ที่เปิดแท็บค้างเห็น cache เก่า)

---

## Root cause

`functions/scores.js` → `saveAllInOneWithConfig` **ไม่ได้ destructure `gradeRecords`**
ที่ frontend ส่งมา (`src/Scripts_Score.html:968`) → payload ถูกทิ้งเงียบ ๆ

ผลลัพธ์: `grade_summary` ไม่มีใครเขียนตอน runtime (เขียนครั้งเดียวตอน
`db/migrate-from-sheets.js:294`) → `missing.js:12 getTeacherRiskDashboard`
query ได้ 0 rows → การ์ดขึ้น "ยอดเยี่ยม! ไม่มีนักเรียนกลุ่มเสี่ยง"

ครูกด "บันทึก" ได้ `{status:'success'}` ทุกครั้ง ไม่มี error ไม่มี log
คะแนนดิบใน `score_database` ยังครบ ไม่มีข้อมูลสูญหาย

---

## แก้ไปแล้ว (committed ยัง — ยังไม่ push)

| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `functions/scores.js` | เพิ่ม `gradeRecords` เข้า destructure (บรรทัด 239) + `_writeGradeRows()` bulk upsert ลง `grade_summary` (บรรทัด 196) + เรียกใช้ (บรรทัด 300) |
| `db/backfill-grade-summary.js` | **ไฟล์ใหม่** — คำนวณย้อนหลังจาก `score_database` dry-run เป็น default |
| `CLAUDE.md` | เพิ่ม `gradeRecords` payload, สูตร `calcRow`, วิธีรัน backfill |

### สูตรที่ backfill ใช้ (ตรงกับ `calcRow` / `calculateGrade` ใน frontend)

```
sumFormative     = Σ formative_i
effectiveMidterm = midterm_re ถ้ามีค่า มิฉะนั้น midterm
total            = sumFormative + effectiveMidterm + final
grade            = remark ถ้าเป็น 'ร'/'มส' มิฉะนั้น calculateGrade(total)

calculateGrade: ≥80→4  ≥75→3.5  ≥70→3  ≥65→2.5  ≥60→2  ≥55→1.5  ≥50→1  else 0
```

verify แล้วด้วย test 10 เคส (midterm_re ทับ, remark ทับเกรด, ขอบ 50/49.5,
ช่องว่างทั้งแถว) ตรงกับ frontend ทุกเคส ต่างแค่ float noise ที่ backfill ปัด 2 ตำแหน่ง

---

## ขั้นตอนที่ต้องทำ

### 1. Dry-run — ทำแล้ว (2026-08-13) ปลอดภัยแล้วหลังใส่ gate

```bash
cd "/Users/sik/Documents/[01] Project/Coding/web_PSSMS"
node db/backfill-grade-summary.js
```

ผลล่าสุด: คำนวณได้ 1 รายการ (ข้ามเพราะกรอกไม่ครบ 89, ไม่มี subject_config 1),
เข้าข่ายกลุ่มเสี่ยง 0 รายการ — apply แล้วเขียนแค่ 1 แถวที่ไม่เสี่ยง ปลอดภัย
ไม่ต้องรอ term จบก่อนแล้ว (gate กันของไม่ครบให้แล้ว)

### 2. เขียนจริง

```bash
node db/backfill-grade-summary.js --apply
```

### 3. Restart + verify

```bash
kill $(lsof -ti :3000) 2>/dev/null; node server.js &
```

เปิด http://localhost:3000 → login เป็นครู → ดู dashboard

⚠️ **ต้องปิดแท็บแล้วเปิดใหม่ ไม่ใช่แค่ refresh** — `Scripts_Teacher.html:484`
cache ผลไว้ที่ `sessionStorage['grade_risk_v3_<teacherId>_<term>_<year>']`
(bump จาก v2 แล้ว — deploy ครั้งนี้ทุกคนเห็นค่าใหม่ทันทีไม่ต้องรอ cache หมดอายุ)

### 4. Verify ว่า save path ใหม่ทำงาน (สำคัญ — กัน regression)

เข้าหน้า ปพ.5 วิชาใดวิชาหนึ่ง แก้คะแนนเด็ก 1 คนให้ตกเกณฑ์ กดบันทึก แล้วเช็ค:

```bash
cd "/Users/sik/Documents/[01] Project/Coding/web_PSSMS"
node -e "
require('dotenv').config();
require('./lib/db').query(
  \"SELECT student_id,subject_code,total_score,grade,remedial_status FROM grade_summary ORDER BY student_id DESC LIMIT 5\"
).then(r=>{console.table(r.rows);process.exit()});
"
```

ถ้ามีแถวใหม่ขึ้นตรงกับที่เพิ่งกรอก = fix ทำงานจริง

### 5. Deploy

```bash
git add -A
git commit -m "fix: grade_summary ไม่ถูกเขียน — saveAllInOneWithConfig ตก gradeRecords"
git push
```

Railway auto-deploy จาก `main` → https://pssms-web-production.up.railway.app

**หลัง deploy ต้องรัน backfill ชี้ไปที่ production DB ด้วย** (ถ้า `.env` ในเครื่อง
ชี้ Railway อยู่แล้ว ขั้น 2 ก็ครอบคลุมแล้ว — เช็ค `DATABASE_URL` ให้ชัวร์ก่อน)

---

## ปัญหารองที่ยังไม่แก้ (ตั้งใจไม่แตะ — surgical changes)

| # | จุด | ผล | แนะนำ |
|---|---|---|---|
| 0 | ~~แถว `grade_summary` ค้างหลังยกเลิก remark~~ | ~~ครูปลด มส แล้วการ์ดยังโชว์~~ | **แก้แล้ว** — gate ที่ไม่ผ่านจะ DELETE แถวเก่าทิ้ง |
| 1 | `missing.js:19` `JOIN users u` เป็น INNER | นักเรียนที่ถูก promote / ลบ หายจากการ์ดเงียบ ๆ | เปิด issue รอดูข้อมูลหลัง backfill ก่อน |
| 2 | `missing.js:21` `u.department as class_name` | ได้ห้อง **ปัจจุบัน** ไม่ใช่ห้องตอนเทอมนั้น — ดูย้อนหลังจะผิดห้อง | เปิด issue ต้องใช้ historical fallback แบบ `getStudentsByClass` |

ข้อ 1–2 อยู่ใน query เดียวกัน ถ้าจะแก้ควรแก้พร้อมกัน (cache key `grade_risk_v2_`→`v3` bump แล้ว — ไม่ใช่ปัญหาค้างอีกต่อไป)

---

## ห้ามทำซ้ำ

- **อย่าแก้ที่ `public/index.html`** — เป็น shell 160 บรรทัด frontend จริงอยู่ที่ `src/*.html`
  serve สดผ่าน `routes/assets.js` ไม่มี build step (CLAUDE.md ตรงนี้เขียนไว้ผิด)
- **อย่าแปลง remark เป็นเกรดซ้ำใน backend** — `calcRow()` เขียนทับช่อง grade ให้แล้ว
