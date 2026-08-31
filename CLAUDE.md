# PSSMS Web — Node + Railway PostgreSQL

ระบบบริหารจัดการสถานศึกษา 4 ฝ่าย โรงเรียนภูพระบาทวิทยา — **web rewrite** ของ GAS prototype เดิม (อ่าน `../src/` เป็น reference เท่านั้น, ไม่ deploy ไป GAS แล้ว).

พัฒนาโดย: ครูน๊อต ศิกษก เดินรีบรัมย์

---

## Secretary Pipeline — MANDATORY

**ทุก request ในโปรเจคนี้ต้องผ่าน secretary skill ก่อนเสมอ ไม่มีข้อยกเว้น**

ก่อนทำอะไรทั้งนั้น ให้ invoke `.agents/skills/secretary/SKILL.md` โดย:
1. วิเคราะห์ request → เลือก pipeline (ux / frontend / backend / full-stack / read-only)
2. แจ้ง pipeline ที่วางไว้ให้ผู้ใช้รับทราบ
3. Spawn agents ตามลำดับ หรือ (กรณี read-only เช่น อธิบาย/อ่าน code) ตอบตรงโดยไม่ต้อง spawn

Read-only = request ที่ไม่มีการแก้ไข file ใดเลย → secretary วิเคราะห์แล้วตอบตรง ไม่ต้อง spawn agent

---

## Stack & Deploy

- **Runtime:** Node.js 24, Express 4
- **DB:** PostgreSQL (Railway), host `autorack.proxy.rlwy.net:47000` (จาก `DATABASE_URL`)
- **Auth:** JWT (HS256, 90-day exp) — store ใน `localStorage.pssms_jwt`
- **Frontend:** SPA `public/index.html` — bundle จาก GAS HTML files (Index.html + Pages + Scripts) ใช้ `gas-shim.js` เป็น polyfill ของ `google.script.run`
- **Static + API:** server เดียว port 3000

### Run dev server
```bash
cd web
node server.js          # หรือ npm run dev (nodemon)
# Kill ก่อน restart:
kill $(lsof -ti :3000) 2>/dev/null
```

### Environment (`.env`)
```
DATABASE_URL=postgresql://localhost:5432/pssms_dev
JWT_SECRET=long_random_string
PORT=3000
SPREADSHEET_ID=... (legacy — sheets.js ยังใช้สำหรับ migration ไม่ใช่ runtime)
```
ดู `.env.example` (commit ไว้) เป็นแม่แบบ. `.gitignore` คลุม `.env.*` ทั้งหมดยกเว้น `.env.example`

---

## Dev DB แยกจาก Production

**`.env` ชี้ Postgres ในเครื่องเสมอ** — เดิมชี้ Railway ตรง ๆ ทำให้เทสทุกครั้งโดนข้อมูลครูจริง

| | dev | production |
|---|---|---|
| host | `localhost:5432/pssms_dev` | `autorack.proxy.rlwy.net:47000/railway` |
| อยู่ที่ | `.env` (default) | `.env.prod` (gitignored, chmod 600) |
| ข้อมูล | seed ปลอม 6 นักเรียน 2 ครู | ของจริง |
| SSL | ปิด (local ไม่รองรับ) | เปิด |

`lib/db.js` เลือก SSL อัตโนมัติจาก hostname — localhost → ปิด, ที่เหลือ → เปิด

### ตั้งครั้งแรก
```bash
brew install postgresql@18        # ต้องตรง major ของ prod (เช็คด้วย SELECT version())
brew services start postgresql@18
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"   # keg-only ต้องใส่ PATH เอง
createdb pssms_dev
pg_dump --schema-only --no-owner --no-privileges "$PROD_URL" | psql -q pssms_dev
pg_dump --data-only --no-owner --table=system_settings --table=curriculum --table=print_config "$PROD_URL" | psql -q pssms_dev
node db/seed-dev.js
```
ก๊อป `system_settings` มาด้วยเพราะไม่มี PII และ **massive grid auto-generate ตายถ้าไม่มี TermData**

### ต่อ production (opt-in ต่อคำสั่ง)
```bash
DATABASE_URL=$(node -e "require('dotenv').config({path:'.env.prod'});process.stdout.write(process.env.DATABASE_URL)") node db/backfill-grade-summary.js
```

### กติกา
- **ห้ามก๊อปข้อมูลนักเรียนจริงลง dev** — seed เป็นของปลอมทั้งหมด
- `db/seed-dev.js` ปฏิเสธรันถ้า `DATABASE_URL` ไม่ได้ชี้ localhost (parse hostname ไม่ใช่ regex)
- **seed ต้องคงรูปทรงข้อมูลจริง** — รหัสนักเรียนมี 0 นำหน้า (`'01903'`), ห้อง `ม.X/Y`,
  HR ครบ จันทร์-ศุกร์ period `'0'`, calendar event สีแดง `#dc3545` 1 อัน
  ถ้า seed ใช้ id เลขล้วน บั๊กตระกูล normID/cleanStdId จะไม่โผล่ตอนเทส
- **เทสบน dev ไม่ต้องคืนค่าเดิม** — แต่ถ้ารันด้วย `.env.prod` ยังต้องคืนเหมือนเดิม
- **seed มีครู 5 คนเพราะ scoring ต้องมีตัวเปรียบเทียบ** — `teacher3` สอน ว 5 คาบ (ถนัดวิทย์),
  `teacher4` สอน ท อย่างเดียว + มีใบลาอนุมัติคร่อมคาบทดสอบ + มีประวัติสอนแทนย้อนหลัง 4 คาบ,
  `teacher5` เป็นครูที่ปรึกษาร่วม ม.2/1 · `dept` จงใจใส่ "วิชาเอก" (`ฟิสิกส์` `พลศึกษา`)
  ไม่ใช่ชื่อกลุ่มสาระ เพื่อล้อ production
- `substitute_assignments` seed **ผูกกับสัปดาห์ปัจจุบันเสมอ** (`mondayOffset()`) เพราะหน้า
  จัดตารางสอนแทนเปิดมาด้วยตัวกรอง `_subWeekRange(0)` — ถ้า hardcode วัน พอเวลาผ่านไป
  จะเปิดหน้ามาเจอ "ไม่มีรายการ" ทุกแท็บ. ครบ 3 สถานะ (จัดแล้ว 4 / รอจัด 2 / ยกเลิก 1)
  ⚠️ สร้างวันที่ด้วย local getFullYear/getMonth/getDate **ห้ามใช้ `toISOString()`** —
  TZ ไทย +07 ทำให้เที่ยงคืนตามเครื่องกลายเป็นวันก่อนหน้าใน UTC แล้ว `date` กับ
  `day_of_week` หลุดกันคนละวัน

---

## Architecture

```
Browser (SPA: index.html)
   │
   │  fetch POST /api/gas/<fnName>
   │  body: { args: [...] }
   │  Authorization: Bearer <jwt>
   ▼
Express (server.js)
   ├─ routes/gas.js     →  handlers map { fnName: (args, user) => ... }
   │                       JWT verify (skip PUBLIC_FNS: checkLogin, getSystemConfig)
   ├─ routes/assets.js  →  static-like asset routing
   └─ functions/*.js    →  business logic (PostgreSQL via lib/db.js)
                            │
                            ▼
                       Railway PostgreSQL
```

**gas-shim.js** (`public/gas-shim.js`) — แทน `google.script.run`. ทุก call:
```js
google.script.run.withSuccessHandler(cb).fnName(a, b, c);
// → fetch('/api/gas/fnName', { method:'POST', body: JSON.stringify({args:[a,b,c]}) })
// → server response: { __result: ... }  หรือ  { __error: '...' }
// → ถ้า fnName === 'checkLogin' && status === 'success' → response มี __jwt → save
```

---

## โครงสร้างไฟล์

```
web/
├── server.js                    Express bootstrap
├── .env                         secrets (gitignored)
├── lib/
│   ├── db.js                    PostgreSQL pool + query() helper (max:20, idleTimeout:30s)
│   ├── cache.js                 in-memory TTL cache (get/set/del)
│   └── sheets.js                legacy Google Sheets client (migration only)
├── middleware/                  auth + logging (loaded by routes)
├── routes/
│   ├── gas.js                   handlers map + JWT verify + dispatcher
│   └── assets.js                non-GAS-style routes
├── functions/                   one file per logical domain
│   ├── attendanceReport.js      ⭐ shared formula: getSemesterReport,
│   │                              getAllSubjectsReport, getTeacherAtRiskDashboard
│   ├── attendance.js            saveAttendanceBatch, lesson record, grids
│   ├── scores.js                ปพ.5: getSubjectConfig, saveAllInOneWithConfig,
│   │                              getAllInOneScoreGridData
│   ├── users.js                 addUser, editUser, deleteUser, importCSV
│   ├── students.js              getStudentsByClass (3-tier historical fallback)
│   ├── clubs_write.js           createClub, updateClub, register, unregister
│   ├── timetable.js / timetable_admin.js
│   ├── leave.js / getLeaveBundle.js
│   ├── morning.js               กิจกรรมหน้าเสาธง
│   ├── sarabun.js               สารบรรณ
│   ├── budget.js                งบประมาณ
│   ├── lesson_records.js        detailed lesson records
│   ├── config.js                system config + calendar
│   ├── getTeacherDashboardBundle.js  parallel sections
│   ├── getAdminDashboardBundle.js
│   ├── missing.js               catch-all สำหรับ functions เล็ก ๆ เยอะ
│   │                              (risk dashboards, club admin, promote, etc.)
│   └── ... (อื่น ๆ ตามชื่อ)
├── public/
│   ├── index.html               SPA shell (compiled from GAS HTML)
│   └── gas-shim.js              google.script.run polyfill
└── db/                          schema dumps / migration scripts
```

---

## PostgreSQL Schema

24 tables. PK ที่ระบุคือ composite/primary keys ที่สำคัญต่อ `ON CONFLICT`.

### Indexes (non-PK)

| Table | Index | Columns |
|---|---|---|
| `attendance` | `idx_attendance_date` | `date` |
| `attendance` | `idx_attendance_session` | `session_id` |
| `attendance` | `idx_attendance_student` | `student_id` |
| `attendance` | `idx_attendance_teacher` | `teacher_id` |
| `attendance` | `idx_attendance_composite` | `(teacher_id, subject_code, class, term, year)` |
| `morning_activity` | `idx_morning_teacher_class` | `(teacher_id, class, term, year)` |
| `timetable` | `idx_timetable_teacher` | `teacher_id` |
| `timetable` | `idx_timetable_day` | `day` |
| `timetable` | `idx_timetable_teacher_day` | `(teacher_id, day, term, year)` |
| `score_database` | `idx_score_subject` | `subject_code` |
| `score_database` | `idx_score_student_subject` | `(student_id, subject_code, term, year)` |
| `substitute_assignments` | `idx_sub_date` | `date` |
| `substitute_assignments` | `idx_sub_teacher` | `teacher_id` |
| `users` | `idx_users_student_year` | `(year, status)` WHERE UPPER(role)='STUDENT' |

### Auth & users
| Table | Cols | PK / Note |
|---|---|---|
| `users` | username, password, full_name, role, department, email, year, status | PK `username`. role: Student/Teacher/Admin/Executive. Promote update in-place |
| `user_history` | id, username, action, changed_by, old_data jsonb, new_data jsonb, timestamp | audit log + snapshot ก่อน promote |
| `system_settings` | key, subkey, value, ... | active term/year, TermData rows |

### Curriculum / Timetable
| Table | Cols | Note |
|---|---|---|
| `timetable` | id, subject_code, subject_name, level, room, location, teacher_id, day, period, term, year | level/room แยก (level เช่น `ม.4`, room=`1` → combined `ม.4/1`) |
| `curriculum` | ... | ตัวชี้วัด |
| `substitute_assignments` | substitute teacher slots |

**HR timetable:** `setHomeroomTeacher` / `setAllHomeroomTeachers` insert **5 rows** ต่อ teacher+class (จันทร์–ศุกร์, period `'0'`) เพื่อให้ HR ขึ้น dropdown ทุกวันทำการ. ห้าม insert เฉพาะวันจันทร์ — HR จะหายไปวันอื่น.

### Attendance
| Table | Cols | Note |
|---|---|---|
| `attendance` | id, timestamp, date, term, year, subject_code, subject_name, class, period, student_id, student_name, status, teacher_id, session_id | `class` = combined `ม.X/Y` |
| `academic_records` | บันทึกการสอน (present/absent/leave counts) |
| `detailed_lesson_records` | บันทึกหลังสอนละเอียด |
| `morning_activity` | กิจกรรมหน้าเสาธง |

### Scores (ปพ.5)
| Table | Cols | PK |
|---|---|---|
| `subject_config` | subject_id, subject_code, class_name, term, year, score_ratio, indicators_json, teacher_id, **exam_indicators_json** | PK `(subject_code, class_name, term, year)` |
| `score_database` | uid, student_id, subject_code, indicator_id, **score TEXT**, term, year | PK `(student_id, subject_code, indicator_id, term, year)` — `score` เป็น TEXT เพราะ remark indicator เก็บ `'-'`/`'ร'`/`'มส'` |
| `score_history` | id, timestamp, teacher_id, student_id, subject_code, indicator_id, **old_score TEXT, new_score TEXT**, term, year | audit log, scores เป็น TEXT |
| `qualitative_assess` | student_id, subject_code, term, year, **char1-4, char_total, char_grade, read1-4, read_total, read_grade, comp** | PK `(student_id, subject_code, term, year)` |
| `grade_summary` | student_id, subject_code, total_score, grade, remedial_status, attendance_percent, term, year | ใช้สำหรับ grade-based risk card (0, ร, มส.) |
| `print_config` | header config สำหรับพิมพ์ ปพ.5 |

### Clubs
| Table | Cols | PK |
|---|---|---|
| `clubs` | club_id, club_name, description, capacity, term, year, status, created_at, updated_at | PK `club_id`. clubId format `CLUB${Date.now()}` |
| `club_advisors` | club_id, teacher_id, teacher_name, role, term, year | many-to-many |
| `club_members` | 1 student : 1 club : 1 term |

### Other
| Table | Note |
|---|---|
| `leave_records` | การลา (request_date, status, admin_comment) |
| `sarabun` | ทะเบียนสารบรรณ |
| `budgets` | งบประมาณ — PK `project_id`, มี `created_by` (JWT id ของคนสร้าง) |
| `calendar_events` | ปฏิทินกิจกรรม |
| `maintenance` | บำรุงรักษา |

---

## Function Signature Convention

`gas-shim.js` ส่ง args เป็น array. Backend handlers **destructure**:

```js
async function fnName([arg1, arg2, arg3]) { ... }
```

**ต้องตรงกับลำดับใน frontend call** — `google.script.run.fn(a, b, c)` → `args = [a, b, c]`. Signature mismatch = bug เงียบ ๆ ที่ param shift จนกลายเป็น undefined.

ตัวอย่างที่เคยเจอ:
- `editUser(form)` — 1 object, อย่าใส่ `[username, form]` แยก. `username` อยู่ใน `form.username`
- `getAllInOneScoreGridData(subjectCode, className, term, year)` — 4 args, **ไม่มี** teacherId
- `getSemesterReport(subjectCode, className, term, year)` — 4 args (ไม่ใช่ `(teacherId, term, year)`)
- `createClub(payload)` / `updateClub(payload)` — 1 object, clubId อยู่ใน payload สำหรับ update. createClub generate clubId เสมอ (`CLUB${Date.now()}`)
- `manualCreateAffected(teacherId, startDate, endDate, leaveId)` — **4 args**
  `leaveId` เพิ่มทีหลัง ถ้าไม่ส่ง คาบสอนแทนจะไม่ผูกใบลา แล้วป้ายประเภทการลาหายทั้งหน้า
- `saveStudentRemarkDirectly(studentId, subjectCode, term, year, remark)` — **5 args**
  ลำดับตาม `updateRemarkInstant()` ใน `src/Scripts_Score.html` เคยประกาศ backend เป็น
  `[studentId, remark, term, year]` (4 ตัว) → `remark` รับค่า subjectCode ไป
  ส่วนค่าจริงหล่นหาย. คืน `{success, val}` เพราะ frontend เช็ค `res.success`
  ไม่ใช่ `res.status` (ต่างจาก write function อื่น)

### Field naming priority

GAS frontend ใช้ชื่อ field หลากหลาย. Backend ต้องรองรับทั้งหมด:
```js
const pickName = (u) => String(u.fullname || u.fullName || u.full_name || '').trim();
const pickDept = (u) => String(u.department || u.dept || '').trim();
```

---

## Score (ปพ.5) Conventions

### `score_ratio`
`"formative:midterm:final"` เช่น `"70:10:20"` (max scores)

### `indicators_json`
```js
[
  { code: 'ว1.1', name: 'งาน 1', score: 30, description: '' },
  { code: 'ว1.2', name: 'งาน 2', score: 40, description: '' },
]
```
ผลรวม `score` ต้องเท่ากับค่า formative ใน ratio

### `exam_indicators_json`
```js
{ midterm: { code: 'ว-กลาง', description: 'สอบกลางภาค' },
  final:   { code: 'ว-ปลาย', description: 'สอบปลายภาค' } }
```

### `indicator_id` ใน score_database
- `formative_0`, `formative_1`, ... = index ตรงกับ `indicators_json[i]`
- `midterm` = สอบกลาง
- `midterm_re` = ซ่อมกลาง
- `final` = สอบปลาย
- `remark` = `ร` / `มส` / `-`

**ค่าว่าง = ลบแถว** — `_writeScoreRows` แยก payload เป็น 2 กอง: ช่องที่มีค่า → upsert,
ช่องว่าง (`''`/`null`) → `DELETE` แถวนั้นทิ้ง ทั้งคู่อยู่ใน transaction เดียวกัน
เดิมกรองช่องว่างทิ้งเฉย ๆ ทำให้ครูลบคะแนนแล้วค่าเก่าค้างใน DB (refresh กลับมา)
⚠️ `remark` ใช้ `'-'` แทน "ไม่มี" ไม่ใช่ `''` เลยไม่โดนลบ

### `qualRecords` payload (frontend → backend)
```js
{ studentId, subjectCode, term, year,
  char1, char2, char3, char4, charTotal, char (=grade 0-3),
  read1, read2, read3, read4, readTotal, read (=grade 0-3) }
```
ห้ามใช้ `readingWriting/charJson/compJson` (ชื่อเก่า ผิด)

### `gradeRecords` payload (frontend → backend)
```js
{ studentId, subjectCode, totalScore, grade, remark }
```
`saveAllInOneWithConfig` เขียนลง `grade_summary` ผ่าน `_writeGradeRows()`.
`grade` มีค่า remark (`ร`/`มส`) อยู่แล้วเมื่อครูเลือก remark — `calcRow()` ใน
`src/Scripts_Score.html` เขียนทับช่องเกรดให้ ไม่ต้องแปลงซ้ำใน backend.

**ต้อง destructure `gradeRecords` ใน `saveAllInOneWithConfig`** — เคยตกหล่นทำให้
`grade_summary` ว่างและการ์ด "นักเรียนกลุ่มเสี่ยง (0, ร, มส.)" ไม่ขึ้น
โดยที่ frontend ยังได้ `{status:'success'}` ทุกครั้ง (silent drop)

### สูตรรวมคะแนน (`calcRow` — ต้องตรงกันทั้ง frontend / backfill)
```
sumFormative     = Σ formative_i
effectiveMidterm = midterm_re ถ้ามีค่า มิฉะนั้น midterm
total            = sumFormative + effectiveMidterm + final
grade            = remark ถ้าเป็น 'ร'/'มส' มิฉะนั้น calculateGrade(total)

calculateGrade: ≥80→4  ≥75→3.5  ≥70→3  ≥65→2.5  ≥60→2  ≥55→1.5  ≥50→1  else 0
```

### Completeness gate — ก่อนเขียน `grade_summary`

`calcRow()` คำนวณ total บนหน้าจอโดยถือว่าช่องว่าง = 0 เสมอ (สำหรับ preview
สด) — แต่ frontend autosave ทุก 3 วินาทีหลังแก้ 1 ช่อง แล้วส่ง `gradeRecords`
ของนักเรียน**ทั้งห้อง**ทุกครั้ง ถ้าเขียนตรง ๆ ลง `grade_summary` จะได้ grade=0
ปลอมสำหรับนักเรียนที่ยังกรอกคะแนนไม่ครบ (พบจริง: 90/91 false positive ตอน
เทอมยังไม่จบ)

ทั้ง `_writeGradeRows()` (`functions/scores.js`) และ backfill script ต้องกรอง
ผ่าน `_isGradeRowComplete()` ก่อนเขียนเสมอ — เขียนได้เมื่อ:
- นักเรียนถูกตั้ง remark `ร`/`มส` โดยครูชัดเจน (ถือว่า complete เสมอ — remark
  แปลว่า "ไม่มีคะแนนให้" อยู่แล้วโดยนิยาม), **หรือ**
- ทุก `formative_0..N-1` (N = จำนวน indicator ใน config ตอนนั้น) มีคะแนนจริง
  (`score !== ''`) และ `midterm`/`final` มีคะแนนด้วย **เฉพาะกรณี** ratio
  ส่วนนั้น > 0 (`midterm_re` ไม่บังคับ — เป็นแค่ตัวทับ)

นักเรียนที่ไม่ผ่าน gate จะ**ไม่เขียน**แถวใหม่ และ **`DELETE` แถวเก่าทิ้งด้วย** —
`grade_summary` เก็บเฉพาะเกรดที่ตัดสินได้จริง ณ ตอนนั้น

เหตุผลที่ต้อง DELETE ไม่ใช่แค่ skip: ครูตั้ง remark `มส` (bypass gate → เขียนแถว)
แล้วเปลี่ยนใจยกเลิกกลับเป็น `-` ถ้าแค่ skip แถว `มส` เดิมจะค้างตลอดไป
การ์ด "นักเรียนกลุ่มเสี่ยง" ก็จะรายงานเด็กที่ครูปลดธงไปแล้ว

### Backfill `grade_summary`
```bash
node db/backfill-grade-summary.js                  # dry-run
node db/backfill-grade-summary.js --term=1 --year=2568
node db/backfill-grade-summary.js --apply          # เขียนจริง
```
คำนวณใหม่จาก `score_database` ด้วยสูตรข้างบน ใช้กับข้อมูลที่บันทึกช่วงที่ `gradeRecords` ตกหล่น
กรองผ่าน completeness gate เดียวกัน (proxy ด้วย `subject_config` ล่าสุดต่อ
`subject_code+term+year` — score_database ไม่เก็บ class ผูกกับ config ตรง ๆ
ยอมรับความคลาดเคลื่อนนี้ที่ data scale ปัจจุบัน) — คน/วิชาที่ไม่มี
`subject_config` เลยจะถูกข้ามเช่นกัน (นับแยกเป็น `ไม่มี subject_config`)

---

## Attendance & Report Logic (Shared)

`functions/attendanceReport.js` เป็น single source of truth สำหรับ 3 endpoints:

| Function | Frontend call | ใช้ที่ |
|---|---|---|
| `getSemesterReport([subjectCode, className, term, year])` | `getSemesterReport(item[0], item[2], term, year)` | หน้ารายงานสถิติเวลาเรียน |
| `getAllSubjectsReport([teacherId, term, year])` | `getAllSubjectsReport(user.id, term, year)` | ทุกวิชาที่ครูสอน |
| `getTeacherAtRiskDashboard([teacherId, term, year])` | bundle parallel section + standalone | Dashboard card |

### Formula (ตรง GAS เดิม)
```
periodsPerWeek    = COUNT timetable rows (subject+level+room+term+year ตรง)
totalCoursePeriods= periodsPerWeek × 20 weeks  (fallback 3 ถ้าหาไม่เจอ)
totalMissed       = absent + leave
percent           = ((totalCoursePeriods − totalMissed) / totalCoursePeriods) × 100

Buckets:  percent < 60  → critical
          60 ≤ p < 80   → ms
          80 ≤ p < 85   → risk
```

**อย่าใช้** `COUNT(*)` ของ attendance เป็นตัวหาร — จะทำให้ percent inflate.

### หน้ารายงานสถิติเวลาเรียน — `ar-*`

`src/Page_Academic_Report.html.html` + `renderReportTable` / `renderAllSubjectsReportTable`
(`src/Scripts_Academic.html`) ใช้ CSS family `ar-*` ที่ล้อความหนาแน่นของ `mg-*`
(เช็คชื่อย้อนหลัง): หัวตาราง + คอลัมน์ ที่/นักเรียน ตรึง, ค่าปกติทำจางให้ข้อยกเว้นเด่น,
ล้อ palette เดียวกับ `mg-*` (โครงใช้ token `--p-*`, ชิปเตือนใช้สีคงที่ชุดเดียวกับ
`mg-late`/`mg-leave`) — **ห้ามใช้ `table-warning` / `bg-info` / `text-dark` ของ bootstrap**
เพราะ hardcode สีโหมดสว่างทั้งพื้นทั้งตัวอักษร แล้วอ่านไม่ออกใน dark mode

- 6 คอลัมน์: ที่ · นักเรียน (ชื่อ+รหัส) · มา·สาย · ลา·ขาด · โควตา · เวลาเรียน
  `%` เป็นตัวบอกสถานะในตัว (สีตาม bucket) เลยไม่มีคอลัมน์ badge แยก
- ระดับสีเตือน 3 ชั้น — ค่า `0` จาง, ค่าที่ไม่ใช่ 0 ขึ้นเป็นเม็ด `.ar-pill`
  (มา=กลาง สาย=เหลือง ลา=น้ำเงิน ขาด=แดง), แถว `มส.`/`หมดสิทธิ์` ย้อมทั้งแถว + แถบซ้าย,
  โควตาเหลือ ≤ `AR_QUOTA_LOW` (3) เหลือง ติดลบแดง
- คอลัมน์ตรึงต้องมีพื้นทึบเสมอ — แถวที่ย้อมสีใช้ `color-mix()` (มี fallback hex บรรทัดก่อนหน้า)
  ไม่ใช่ rgba ไม่งั้นแถวที่เลื่อนผ่านทะลุขึ้นมา และ rule hover ต้องประกาศซ้ำหลัง rule ย้อมสี
- คอลัมน์ มา/สาย และ ลา/ขาด ใส่ค่าใน `.ar-slot` (กว้างคงที่ 44px) **ทั้งใน `<th>` และ `<td>`**
  และ padding ซ้าย-ขวาของ `th.ar-w` กับ `td.ar-num` ต้องเท่ากัน — ไม่งั้น label หัวตาราง
  เหลื่อมจากเม็ดสีที่อยู่ใต้มัน เพราะเม็ดสีกว้างไม่เท่ากันตามจำนวนหลัก
- `copyReportList(groupIdx)` — `''` = ทุกวิชาที่แสดงอยู่, ตัวเลข = เฉพาะกลุ่มนั้น (index ใน `_arGroupKeys`)
  ทั้งคู่เคารพชิปกรองที่ active อยู่ อ่านจาก `_arRows` ที่ render ล่าสุด
  ข้อความมี `%` + ขาด/ลา + โควตา (`⚠️` เมื่อเหลือ ≤ `AR_QUOTA_LOW`, `⛔` เมื่อติดลบ)
  ⚠️ `renderReportTable` (วิชาเดียว) ต้องแนบ `subjectCode/subjectName/className` **และ
  `remainingQuota`** ให้ทุกแถวเอง — `getSemesterReport` ไม่ส่งมาต่างจาก `getAllSubjectsReport`
  (โควตาคำนวณจาก `meta.maxAbsenceQuota - (leave + absent)`) ถ้าลืม ข้อความที่คัดลอกจะขึ้น `undefined`
  และต้องสร้าง `_arRows` **หลัง** `data.sort()` ไม่งั้นลำดับในข้อความไม่ตรงกับตาราง
- การ์ดรายชื่อ 3 ใบเดิมถูกแทนด้วยชิปนับจำนวนบน `.ar-bar` — กดแล้ว `filterReportByBucket()`
  กรองตาราง (กดซ้ำ = ยกเลิก) และซ่อนหัวกลุ่มวิชาที่ไม่เหลือนักเรียน
- Bucket ของแถวคำนวณจาก `_arBucket()` — `>85` ปกติ, `≥80` เฝ้าระวัง, `≥60` มส., ต่ำกว่านั้นหมดสิทธิ์
  ⚠️ subtitle ของหน้าเขียนว่า "ปกติ ≥80%" ซึ่งไม่ตรงกับ `_arBucket` (ของเดิมก็ไม่ตรง ยังไม่แก้)
- `#reportSummaryInfo` เป็น container ถาวรใน page HTML — render ด้วย `innerHTML`
  (เดิม insert ก่อน `document.querySelector('table')` แล้วเขียนทับ `th.innerText` ทีหลัง)

### หน้าจัดตารางสอนแทน — แท็บ "จัดแล้ว" (`sub-*`)

`src/Page_Substitute_Admin.html` + `_renderSubDoneView` / `subPrintDone`
(`src/Scripts_General.html`). แท็บ `รอจัด` / `ยกเลิก` ยังใช้ตารางแบนเหมือนเดิม
ส่วน `จัดแล้ว` สลับไปใช้ `#subDoneView` — 1 การ์ด = 1 วัน, แถวเป็น
`คาบ · วิชา/ห้อง · ครูเดิม → ครูสอนแทน · ปุ่มยกเลิกการจัด`

- **สลับมุมมองต้องอยู่ใน `_renderSubAdminTable()` ไม่ใช่ `subAdminShowTab()`** —
  `subAdminReload()` render ใหม่หลัง fetch โดยไม่ผ่าน tab switcher ถ้าไปสลับที่ switcher
  พอกดค้นหาซ้ำจะเห็นตารางเปล่าซ้อนกับมุมมองใหม่
- เรียงด้วย `_subSortRows()` — **วัน → ชื่อครูที่ลา → `Number(period)`**
  ชื่อครูมาก่อนคาบเพื่อให้คาบของครูคนเดียวกันอยู่ติดกันในการ์ดของวันนั้น (ครูลาทั้งวัน
  มักมีหลายคาบ ถ้ากระจายอยู่คนละที่จะอ่านว่า "วันนี้ใครไม่อยู่บ้าง" ยาก)
  **ห้ามเรียง period เป็น string** ไม่งั้นคาบ 10 มาก่อนคาบ 2
  ใช้ร่วมกับหน้าพิมพ์ (`_subBuildPrintHtml`) — ลำดับบนจอกับบนกระดาษจึงตรงกันเสมอ
- `subPrintDone()` เขียน HTML ลง iframe overlay เต็มจอ (`#subPrintIframe`) แบบเดียวกับ
  `tcPrintMembers` — ไม่ต้องสู้กับ layout ของ SPA.
  ⚠️ **`@page` ต้องประกาศที่ document ของ SPA ด้วย ไม่ใช่แค่ในเอกสารใน iframe** —
  Chrome ใช้ page description ของ **main frame** ตอนสั่งพิมพ์จาก subframe แล้วทิ้ง `@page`
  ของ frame ทิ้ง กระดาษเลยออกมาแนวตั้งและตารางโดนตัดขอบขวา ทั้งที่ CSS ข้างในสั่ง
  `size:A4 landscape` ไว้ถูกแล้ว. `subPrintDone` จึง inject `<style id="subPrintPageRule">`
  เข้า `document.head` ตอนเปิด overlay และถอดออกใน `_closeSubPrintOverlay`
  (เทสได้ด้วย `chrome --headless --print-to-pdf` แล้วอ่านขนาดด้วย `pdfinfo` —
  A4 landscape = `841.92 x 594.96 pts`)
  ยังมีที่อื่นใช้ pattern เดิมและติดบั๊กเดียวกัน: `printRiskReport` ใน `src/Scripts_Teacher.html` `_subBuildPrintHtml(rows)` แยกออกมา
  เพื่อเทสได้โดยไม่ต้องเปิด print dialog. ชื่อโรงเรียนอ่านจาก `localStorage.pssms_school_name`
  (`_syncSchoolBrandingFromServer` ใน `Scripts_Core.html` เป็นคนเซ็ต)
- ⚠️ **`</script>` ในสตริงต้องเขียนเป็น `<\/script>`** — `routes/assets.js` strip ด้วย
  `/<\/script>/gi` ตอนเสิร์ฟ ถ้าไม่ escape ไฟล์ทั้งไฟล์จะถูกตัดกลางคัน
- ตัวกรองเปิดมา default = **วันนี้** (ไม่ใช่สัปดาห์นี้) — งานประจำวันคือ "วันนี้ใครไม่อยู่"
  อยากดูช่วงกว้างใช้ปุ่ม สัปดาห์นี้ / สัปดาห์หน้า. seed จึงต้องมีคาบของ `day 0` ด้วยเสมอ
- ⚠️ **คนที่เพิ่งสร้างคาบสอนแทนต้องเลื่อนตัวกรองไปครอบช่วงที่สร้าง** — ใบลาเกือบทุกใบ
  เป็นวันข้างหน้า พอ default เป็น "วันนี้" คาบที่เพิ่งสร้างถูกกรองทิ้งจนดูเหมือน
  `manualCreateAffected` ไม่ทำงาน (ทั้งที่ DB มีแถวครบ)
  · อนุมัติใบลา → `submitLeaveReview` ตั้ง `_subFocusRange = {from,to}` ก่อน `loadPage`
    แล้ว `initSubstituteAdminPage()` หยิบไปใช้แทน "วันนี้" (ใช้ครั้งเดียวแล้วเคลียร์)
  · เพิ่มคาบเอง → `submitManualCreate` เซ็ต `subFilterFrom/To` เป็น start/end ก่อน `subAdminReload()`
- `getPendingSubstitutes` **LEFT JOIN `leave_records`** ผ่าน `leave_id` คืน `leaveType` /
  `leaveReason` เพิ่ม → `_subLeaveChip()` ทำป้าย (ลาป่วย=แดง ลากิจ=เหลือง reason อยู่ใน
  `title`) หน้าพิมพ์ใส่วงเล็บต่อท้ายชื่อครูเดิม
  ⚠️ ต้องเป็น LEFT JOIN — คาบที่กด "เพิ่มเอง" ไม่มี `leave_id` ถ้า INNER จะหายทั้งแถว
- ครูเดิมแสดงเป็น**ตัวอักษรสีเทา ไม่ขีดฆ่า** — ครูไม่ได้ถูกยกเลิก แค่ไม่อยู่

### จัดตารางสอนแทนอัตโนมัติ (auto substitute)

`functions/substituteAuto.js` — **2 RPC แยกกันโดยตั้งใจ** ทั้งคู่ `ADMIN_ONLY`:

| RPC | args | ทำอะไร |
|---|---|---|
| `getAutoAssignPreview([assignmentIds, term, year])` | arg แรกเป็น **array** | read-only ล้วน คืนข้อเสนอ + ตัวสำรอง 4 คน/คาบ |
| `applyAutoAssign([picks], user)` | `[{assignmentId, subTeacherId, note}]` | เขียนจริง คืน partial success |

ไม่ทำเป็นฟังก์ชันเดียวแล้วใส่ flag `dryRun` เพราะ `ADMIN_ONLY` / write-set ใน `routes/gas.js`
key ด้วย **ชื่อฟังก์ชัน** — flag จะทำให้ "call นี้เขียนไหม" ตอบจาก request line ไม่ได้อีก

#### คาบโฮมรูมไม่เข้าระบบสอนแทน

`manualCreateAffected` กรอง `subject_code='HR'` ออกตั้งแต่ต้นทาง (ครูที่ปรึกษาอีกคนของห้อง
ดูแลแทนอยู่แล้ว ทุกห้องบน prod มีที่ปรึกษา 2 คน) `getAutoAssignPreview` ผลัก HR เข้า
`skipped` อีกชั้นเพื่อรองรับแถวเก่าที่สร้างไว้ก่อนหน้า — ใช้ `isHomeroomSubject()` จาก
`lib/subjectGroup.js` ทั้งสองที่

⚠️ เคยลองทำให้ **จัด** คาบ HR ได้ ต้องยกเว้น "แถว HR ห้องเดียวกันไม่นับเป็นคาบชน" ทั้งใน
preview และ `_assertSubstituteFree` ไม่งั้น preview เสนอครูที่ปรึกษาร่วมแล้ว apply ปฏิเสธ
(`ครูคนนี้มีคาบสอนของตัวเองอยู่แล้ว (HR) คาบ 0`) — ตัดคาบ HR ออกทั้งระบบแทน กติกาสองที่จึงตรงกัน

#### Hard exclusion (ตัดก่อนให้คะแนน) — `_rejectReason()`

| กฎ | หมายเหตุ |
|---|---|
| เป็นครูเจ้าของคาบเอง | ตรงกับ `_assertSubstituteFree` |
| ติดคาบสอนตัวเองใน `timetable` (day, period, term, year) | ใช้คอลัมน์ `day_of_week` ที่เก็บไว้ **ห้ามคำนวณจาก `date` ใหม่** |
| ถูกจัดสอนแทน หรือ **เป็นเจ้าของคาบที่ถูกจัดสอนแทน** ที่ date+period นั้น | ข้อหลังจับคาบ "เพิ่มเอง" ที่ไม่มี `leave_id` — ตาราง `leave_records` จับไม่ได้ |
| **ตัวเองลาอยู่** (`leave_records status='อนุมัติ'` คร่อมวันนั้น) | ⚠️ `getAvailableSubstitutes` เดิม**ไม่เช็ค** ครูที่ไม่อยู่โรงเรียนจึงขึ้นว่า "ว่าง" |
| ครบโควตา `MAX_PER_DAY` (2) คาบในวันนั้น | ตัวรับประกันการกระจายภาระ |

#### คะแนน — `SCORE_WEIGHTS`

```
exactSubject 50 · strongPrefix 30 (>=3 คาบ) · weakPrefix 15 (1-2 คาบ)
homeroom 25 · sameClass 8 · workloadPer -6 ต่อคาบใน 30 วัน
tie-break: คะแนน desc → ภาระ asc → ชื่อ  (เทสพึ่งลำดับนี้)
```

⚠️ **ความถนัดดูจาก `timetable` ว่าครูสอน prefix ไหนกี่คาบ ไม่ใช่จาก `users.department`** —
prod เก็บ department เป็น "วิชาเอก" (`ฟิสิกส์` `ดนตรีศึกษา` `นาฏศิลป์` `อุตสาหกรรม`)
ไม่ตรงชื่อกลุ่มสาระ 9 ใน 12 คน และครูวิชาเอกเดียวกันก็สอนคนละกลุ่มได้
seed จึงจงใจใส่วิชาเอกที่ไม่ตรงชื่อกลุ่มสาระ ถ้าใส่ตรงเป๊ะบั๊กนี้จะไม่โผล่ตอนเทส

⚠️ `exactSubject` นับเฉพาะรหัสที่เป็นรายวิชาจริง (`subjectPrefixOf()` ต้องไม่คืน `''`) —
`HR` / `-` / `CLUB_*` ใช้รหัสเดียวกันทั้งโรงเรียน ครูที่ปรึกษาห้องอื่นจะได้ +50 ฟรี

**หน้าต่างนับภาระ = 30 วัน rolling ไม่ใช่ lifetime** — `substitute_assignments` ไม่มีคอลัมน์
term/year จึงนับต่อภาคเรียนไม่ได้ และ lifetime ทำให้ลำดับแช่แข็งถาวรรอบคนที่เคยสอนแทนเยอะ
เมื่อสองปีก่อน (ของเดิม `getAvailableSubstitutes` นับ lifetime)

#### อัลกอริทึม

โหลด context ครั้งเดียว ~6 query (timetable query เดียวรับใช้ 5 อย่าง) แล้ว greedy
เรียงคาบแบบ **scarcity-first** (`eligibleCount` น้อยก่อน → วัน → `Number(period)`) —
เรียงตามเวลาล้วนทำให้คาบเช้าง่าย ๆ กินครูเฉพาะทางคนเดียวที่ว่างไปแล้วคาบบ่ายค้าง
เลือกแล้ว**จองใน `booked` map ทันที** (key `date|period`, seed จาก DB) ไม่งั้นคาบถัดไป
ที่ date+period เดียวกันได้ครูคนเดิมซ้อน

greedy ไม่ optimal และไม่ backtrack **โดยตั้งใจ** — แอดมินรีวิว preview อยู่แล้ว
**อย่าสร้าง Hungarian / min-cost-flow** code ×3 เพื่อตารางที่คนจะแก้มืออยู่ดี

#### apply — sequential เท่านั้น

`_applyOne` ล็อกแถวด้วย `FOR UPDATE` → `_assertSubstituteFree` (export จาก `leave.js`
ห้ามคัดลอก logic) → `UPDATE ... WHERE id=$5 AND status='รอจัด'`
**ห้ามเรียก `leave.assignSubstitute` แทน** — UPDATE ของมันไม่มี status guard แอดมิน 2 คน
ที่ preview แถวเดียวกันจะทับกันเงียบ ๆ

⚠️ **วนด้วย `for...of` ห้ามเปลี่ยนเป็น `Promise.all`** — การกันจัดครูคนเดียวซ้อน 2 คาบใน
batch เดียวพึ่งการที่แถว N-1 commit ก่อนที่แถว N จะอ่าน

ไม่ห่อทั้งชุดใน transaction เดียว — preview เก่าไป 1 แถวไม่ควร rollback อีก 29 แถวที่ดี
คืน `{status:'success', applied[], failed[]}` เสมอ (partial success ไม่ใช่ error)
แล้วให้หน้าจอ `subAdminReload()` กลับมาตรงกับ DB

#### Frontend

- ติ๊กเลือกคาบด้วย checkbox ในแท็บ "รอจัด" → ปุ่ม `#subAutoBtn` → modal `#subAutoModal`
- **toggle ปุ่ม/คอลัมน์ติ๊กอยู่ใน `_renderSubAdminTable()` ไม่ใช่ `subAdminShowTab()`**
  (`subAdminReload()` render ใหม่โดยไม่ผ่าน tab switcher — ยอดบนปุ่มจะค้าง)
- คอลัมน์ติ๊กทำให้ตารางเป็น 9 คอลัมน์ในแท็บนั้น → `colspan` ต้องใช้ `_subColCount()`
- ช่องครูสอนแทนเป็น `<select>` มี `— ไม่จัด (คงไว้รอจัด) —` + ตัวสำรอง + `เลือกครูคนอื่น…`
  (`__more__` ยิง `getAvailableSubstitutes` เดิมแล้วเขียนทับ options ในที่
  — ไม่เปิดโมดัลซ้อนโมดัล เลี่ยงสงคราม z-index/focus-trap)
- `_subAutoDupIdx()` ย้อมแดงและตัดออกจากยอดยืนยันเมื่อ override เลือกครูซ้ำในคาบเดียวกัน
- `_subSelected` ต้องล้างทุกครั้งที่ `subAdminReload()` สำเร็จ (id อาจถูกจัด/ลบไปแล้ว)

#### ยังไม่ทำ (follow-up)

- `getAvailableSubstitutes` (`functions/missing.js`) ยังใช้กติกาเดิม — นับ lifetime,
  ไม่เช็คใบลา, จับกลุ่มสาระจาก `users.department` ของครูที่ลา หน้าจัดมือกับ auto จึงเถียงกัน
- ไม่มี unique constraint กันจองซ้อนระดับ DB (ตรวจ prod แล้วยังไม่มีข้อมูลซ้อน)

### คำศัพท์สถานะ — ต้องตรงกัน backend / frontend

**`leave_records.status`** มี 3 ค่า: `รอพิจารณา` · `อนุมัติ` · `ปฏิเสธ`
เขียนผ่าน `_setLeaveStatus()` ตัวเดียว (throw ถ้า `rowCount=0` — เดิม UPDATE ใบลาที่ไม่มีอยู่
แล้วคืน success เงียบ ๆ) ⚠️ `rejectLeave` เคยเขียน `'ไม่อนุมัติ'` ซึ่งไม่มีที่ไหนอ่าน
ใบลาจะค้างแสดงเป็น "รอพิจารณา" ตลอดไป

**`substitute_assignments.status`** มี 4 ค่า: `รอจัด` · `จัดแล้ว` · `ยืนยันแล้ว` · `ยกเลิก`
- แท็บ "จัดแล้ว" ต้องกรองผ่าน `_subInTab()` ซึ่งรวม `ยืนยันแล้ว` ด้วย — ไม่งั้นพอครูสอนแทน
  กด `confirmSubstitute` แถวจะหายจากทุกแท็บ (แท็บมีแค่ 3 อัน)
- `ยกเลิก` เขียนโดย `deleteLeave` เท่านั้น (`unassignSubstitute` ย้อนกลับเป็น `รอจัด`)
- `saveSubstituteAssignment` เคย INSERT เป็น `รอยืนยัน` ซึ่งไม่มีแท็บไหนแสดง → เปลี่ยนเป็น `จัดแล้ว`

### ลาแล้วเกิดคาบสอนแทนยังไง

```
saveLeaveRequest (teacher_id จาก JWT, status 'รอพิจารณา')
  → reviewLeave (admin) → 'อนุมัติ'
  → frontend ยิงต่อทันที: manualCreateAffected(teacherId, start, end, leaveId)
       สร้าง 1 แถวต่อ (วัน × คาบในตารางสอน) status 'รอจัด'
  → assignSubstitute(assignmentId, subTeacherId, note)  → 'จัดแล้ว'
  → confirmSubstitute(subId) โดยครูสอนแทนเอง            → 'ยืนยันแล้ว'
```

- ⚠️ **`manualCreateAffected` ต้องรับ `leaveId` เป็น arg ที่ 4 และ INSERT ลง `leave_id`** —
  เดิมไม่ผูก ทำให้ `getPendingSubstitutes` join ไม่เจอ ป้ายประเภทการลาว่างทุกแถวบน production
  (dev ไม่เห็นเพราะ seed ผูกให้เอง)
- `assignSubstitute` เช็คคาบชนก่อนเสมอ (`_assertSubstituteFree`): ครูเจ้าของคาบเอง /
  มีคาบสอนของตัวเองใน `timetable` วัน+คาบเดียวกัน / ถูกจัดสอนแทนคาบนั้นไปแล้ว → throw ภาษาไทย
  `getAvailableSubstitutes` กรองให้บนหน้าจอแล้วก็จริง แต่ id มาจาก client ต้องเช็คฝั่ง server ด้วย
- `deleteLeave` ลบคาบที่ยัง `รอจัด` ทิ้ง และตั้งคาบที่จัดครูไปแล้วเป็น `ยกเลิก` (`leave_id=NULL`)
  ในทรานแซกชันเดียวกับการลบใบลา — ครูสอนแทนที่รู้ตัวแล้วต้องเห็นว่าถูกยกเลิก ไม่ใช่แถวหายเฉย ๆ
- `adminCreateLeave(payload)` — **ADMIN_ONLY** แอดมินบันทึกการลาแทนครู (ปุ่ม "เพิ่มการลา"
  บนหน้า `Page_Leave_Admin`) ต่างจาก `saveLeaveRequest` ตรงที่ `teacher_id` มาจาก **payload**
  ไม่ใช่ JWT จึงต้องยืนยันว่า username มีจริงก่อน INSERT และคืน `staff_name` จาก `users`
  payload: `{teacherId, type, startDate, endDate, days, reason, status}`
  `status` = `'อนุมัติ'` (default — แอดมินคือผู้พิจารณาอยู่แล้ว จึงเซ็ต `reviewed_by` ให้ด้วย)
  หรือ `'รอพิจารณา'`. ถ้าอนุมัติ frontend ยิง `manualCreateAffected` ต่อทันทีเหมือน flow กดอนุมัติ
  ⚠️ ช่อง "จำนวนวัน" นับจากช่วงวันที่ให้อัตโนมัติตอน submit — **ห้ามผูก `onchange` กับ
  `input[type=date]`** เพราะ flatpickr เซ็ต `.value` เอง event ไม่ยิง (ใช้ flag `_leaveAddDaysTouched`
  จาก `oninput` ของช่องตัวเลขแทน)
- `deleteSubstituteAssignment(assignmentId)` — **ADMIN_ONLY** ลบคาบสอนแทนทิ้ง
  **เฉพาะ status `รอจัด`** (คาบที่ generate มาเกิน เช่นวันที่ครูมาสอนเองอยู่แล้ว)
  คาบที่จัดครูไปแล้วต้อง `unassignSubstitute` ก่อน — throw ถ้าไม่ใช่ `รอจัด`
  ปุ่มถังขยะอยู่ข้างปุ่ม "จัด" ในแท็บ รอจัด
- FK `substitute_assignments.leave_id` เป็น `ON DELETE SET NULL`
  (`db/migrations/2026-08-17-substitute-leave-fk.sql`) — ตาข่ายรองรับ path อื่น
  เดิมไม่มี `ON DELETE` ลบใบลาที่มีคาบผูกอยู่แล้วพังทั้งคำสั่ง

### Massive Grid — auto-generate คาบย้อนหลัง

`getMassiveAttendanceGrid` ไม่ได้คืนแค่ session ที่เคยเช็คแล้ว แต่เติม**ทุกคาบที่
ควรจะสอน**ให้ด้วย ครูจะได้เช็คย้อนหลังวันที่ลืมโดยไม่ต้องกรอกวัน+คาบเอง

```
slots  = timetable WHERE subject_code+term+year, filter ด้วย normalize(level/room)==className
ช่วง   = system_settings TermData[`${term}_${year}`].value1 (เปิดเทอม)
         → min(value2 ปิดเทอม, วันนี้)   — ไม่ generate อนาคต
ข้าม   = วันหยุดจาก calendar_events ที่ color='#dc3545'
merge  = session ที่มี attendance อยู่แล้วมาก่อน, ที่เหลือ generate (sessionId='')
```

- **วันหยุดกรองเฉพาะตอน generate** — วันที่มี attendance แล้วต้องแสดงเสมอ เพราะ
  โรงเรียนสอนในวันหยุดบางวันจริง (เช่น พืชมงคล 13 พ.ค. 2569 มีข้อมูลเช็ค)
- `#dc3545` เป็น**ข้อตกลงเรื่องสี** ไม่ใช่ column ใน schema (`calendar_events`
  ไม่มีคอลัมน์ is_holiday) — ตรวจแล้ว 12/12 event สีแดงเป็นวันหยุดราชการล้วน
- ไม่มี timetable หรือไม่มี TermData → คืน `[]` fallback ไปแสดงเฉพาะที่เช็คแล้ว
- **HR ไม่ auto** (ตั้งใจ) — จันทร์-ศุกร์ × 3 ช่อง/วัน จะกลายเป็น ~200 คอลัมน์
  ใช้ปุ่ม "เพิ่มวัน" เหมือนเดิม
- Frontend ทำสีเหลือง + ป้าย "ยังไม่เช็ค" ให้คอลัมน์ที่ `sessionId===''`
  และนับรวมไว้บนหัว modal

### Normalize helper
```js
const normalize = (s) => String(s||'').replace(/[^a-zA-Z0-9ก-๙]/g, '');
// 'ม.1/1' → 'ม11', 'ม.1' + '/' + '1' → 'ม11' — match ได้
```

---

## Dashboard Bundles

ลด round-trips โดย parallel-fetch หลาย section ใน 1 request.

### `getTeacherDashboardBundle([teacherId, term, year])`
Return:
```js
{ ts, timetable, calendarEvents, riskDashboard, atRiskDashboard, substitutes }
```
- `timetable` — today schedule (จาก `getTeacherTimetableWithStatus`) **รวมคาบสอนแทนของวันนี้แล้ว**
- `substitutes` — คาบสอนแทน 7 วันข้างหน้า (`getMySubstituteSlots`) → การ์ด
  "คาบสอนแทนของฉัน" (`renderDashboardSubstitutes` มีอยู่ก่อนแล้วแต่ bundle ไม่เคยส่ง data มาให้)
- `calendarEvents` — 14-day strip
- `riskDashboard` — grade-based (0, ร, มส.) จาก `grade_summary` table — แสดงในการ์ด "นักเรียนกลุ่มเสี่ยง"
  - `LEFT JOIN users` (ไม่ใช่ INNER) — นักเรียนที่ promote/ลบไปแล้วต้องยังขึ้นการ์ด
  - ห้องเรียนเอาจาก `attendance.class` ของเทอมนั้น → snapshot ใน `user_history` → `users.department`
    (department ถูกทับตอน promote ใช้ได้เฉพาะปีปัจจุบัน)
- `atRiskDashboard` — attendance-based จาก `attendanceReport.getTeacherAtRiskDashboard` — แสดงใน "กระดานแจ้งเตือนกลุ่มเสี่ยง"

### คาบสอนแทนในตารางสอนของครู

`_substituteRows()` (`functions/timetable.js`) เป็นตัวเดียวที่ดึงคาบสอนแทนมาต่อท้าย
ตารางสอน ใช้ร่วมกันทั้ง `getTeacherTimetableByDate` (หน้าเช็คชื่อ) และ
`getTeacherTimetableWithStatus` (แดชบอร์ด) — เดิมมีแต่ตัวแรกที่ดึง แดชบอร์ดจึงไม่เคย
โชว์คาบสอนแทนเลย

- รูปแถวต่อจาก timetable ปกติ: `[7]=hasRecord` `[8]=isSubstitute` `[9]=originalTeacherName`
  (เดิม `ByDate` ใช้ `[7]` เป็น isSubstitute — ไม่มีใครอ่าน เลยย้ายให้ตรงกับ `WithStatus`)
- กรอง `status IN ('จัดแล้ว','ยืนยันแล้ว')` — ตัด `ยืนยันแล้ว` ทิ้งไม่ได้ ครูกด
  `confirmSubstitute` แล้วคาบจะหายจากตารางตัวเอง
- ⚠️ วันที่ต้องคิดแบบ local (`_localDateStr`) **ห้าม `toISOString()`** — TZ ไทย +07
  ทำให้ช่วงเที่ยงคืนถึง 07:00 ได้วันก่อนหน้า แล้วเถียงกับ `getDay()` ที่เป็น local
  (ครูเปิดแดชบอร์ดตอนเช้ามืดจะไม่เห็นคาบสอนแทนของวันนั้น)
- คาบสอนแทนเข้า cache `tt_date_` / `tt_status_` เดียวกับตารางสอน → ชื่อฟังก์ชันที่
  แก้คาบสอนแทน (`assignSubstitute` `applyAutoAssign` `confirmSubstitute` `manualCreateAffected`
  `deleteLeave` ฯลฯ) ต้องอยู่ใน `TIMETABLE_WRITE_FNS`

#### สิทธิ์เช็คชื่อของครูสอนแทน

`verifyTeacherOwnsSubject(user, code, class, term, year, opts)` — arg ที่ 6 เป็น optional
`{date, period}` ถ้าส่งมาและ timetable ไม่ผ่าน จะ fallback ไปหาแถวใน
`substitute_assignments` ที่ **date + period + subject + class ตรงกันเป๊ะ**

- caller ที่ระบุวันไม่ได้ (`saveAllInOneScores`, `saveSubjectConfig`, remark) **ไม่ส่ง `opts`**
  → ไม่มี substitute path เลย สอนแทน 1 คาบไม่ใช่การเป็นเจ้าของรายวิชา
- ห้ามผ่อนเป็น subject+class เฉย ๆ โดยไม่ดูวัน — เทสใน `test/permissions.test.js`
  ที่ใช้ teacher2 เป็น "ครูที่ไม่ได้สอน ว30205" จะกลายเป็นผ่าน เพราะ seed ให้ teacher2
  สอนแทนวิชานั้นอยู่

### ปุ่มคัดลอกรายชื่อส่ง LINE / Facebook

ทั้ง 2 การ์ดมีปุ่ม copy รายชื่อเป็น plain text ให้ครูส่งเข้าแชทนักเรียน:

| การ์ด | ฟังก์ชัน | จัดกลุ่มตาม | ปุ่มอยู่ที่ |
|---|---|---|---|
| นักเรียนกลุ่มเสี่ยง (เกรด) | `copyRiskListByClass(cls)` | ห้อง → วิชา → ประเภท (0/ร/มส) | header ของการ์ดแต่ละห้อง |
| กระดานแจ้งเตือน (เวลาเรียน) | `copyAtRiskList(bucket)` | วิชา+ห้อง | header ของ bucket ทั้ง 3 (`critical`/`ms`/`risk`) |
| รายงานสถิติเวลาเรียน | `copyReportList(groupIdx)` | วิชา+ห้อง | แถบสรุป (ทุกวิชา) + หัวกลุ่มวิชาแต่ละกลุ่ม |

`copyAtRiskList` อ่านจาก `window.currentAtRiskData` ที่
`renderTeacherAtRiskDashboard()` เก็บไว้ตอน render (แบบเดียวกับ
`window.currentRiskDetails` ของการ์ดเกรด) ใช้ `navigator.clipboard.writeText`
+ `showToast` — ถ้า bucket ว่างจะ toast แจ้งแทนการ copy ค่าว่าง

แต่ละ section wrap ด้วย:
```js
function section(fn) {
  return fn().then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message }));
}
```

### `getAdminDashboardBundle()` — 5 sections (stats, summary, calendar, terms, config)
### `getExecutiveDashboardBundle(dept)` — dept-scoped KPI + alerts

### แถบความคืบหน้าภาคเรียน — `renderTermProgressBar(wrapId, cfg)`

อยู่ใน `src/Scripts_Calendar.html` แต่ใช้ **3 ที่**: หน้าปฏิทินปฏิบัติงาน
(`#termProgressWrap`), dashboard ครู (`#dashTermProgress`), dashboard แอดมิน
(`#adminTermProgress`) — ตัว render สร้าง markup เองทั้งหมด container เป็น div เปล่า

```
ภาคเรียนที่ 1/2569 · 11 พ.ค. 2569 → 10 ต.ค. 2569   สัปดาห์ที่ 15 / 20 · 102 / 153 วัน  [66%]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- `cfg` optional — แอดมินส่ง `systemConfig` จาก bundle มาเลย (ไม่มี RPC เพิ่ม),
  ครู/ปฏิทินไม่ส่ง → ยิง `getSystemConfig` เอง (PUBLIC + cache 300s)
- ไม่มี `termStart`/`termEnd` หรือ `end <= start` → `d-none` + ล้าง innerHTML
  (`system_settings` TermData ของเทอมที่ active เป็นคนกำหนด)
- `TERM_WEEKS = 20` — ตัวหารเดียวกับ `totalCoursePeriods = periodsPerWeek × 20`
  ใน `attendanceReport.js`. ช่วงวันจริงยาวกว่า (153 วัน ≈ 22 สัปดาห์ เพราะรวม
  สัปดาห์สอบ/หยุด) จึง `Math.min` ไว้ที่ 20 ไม่งั้นขึ้น "22/20"
- สีแถบ+badge: ก่อนเปิดเทอม `#9aa0a6` "ยังไม่เปิดเทอม" · ระหว่างเทอม `var(--p-accent)` ·
  หลังปิดเทอม `#198754` "ปิดเทอมแล้ว"
- ⚠️ **บน dashboard ครู container ต้องอยู่นอก `#dashCalendarStrip`** —
  `renderDashboardCalendarEvents()` สั่ง `d-none` ทั้ง strip เมื่อไม่มีกิจกรรม
  ใน 14 วันข้างหน้า แถบจะหายไปด้วย
- ⚠️ **ตัวเลขต้องคั่นด้วยตัวอักษรจริง (`·`) ไม่ใช่ margin ล้วน** — เดิมใช้ `ms-2`
  อย่างเดียว ตัวเลขชนกันอ่านเป็น `15 / 20102 / 153 วัน66%`

### เมนู "สื่อการสอน" — `Page_Teaching_Media`

หน้ารวมการ์ดสื่อการเรียนการสอน คลิกแล้วเปิดในแท็บใหม่
(`window.open(url, '_blank', 'noopener')`) **ครูเพิ่ม/แก้/ลบการ์ดเองได้จากในหน้า**

- `src/Page_Teaching_Media.html` — toolbar (ค้นหา + ชิปกรองกลุ่มสาระ + ปุ่มเพิ่ม/ถังขยะ),
  `#mediaSubjectGrid`, และ modal `#mediaCardModal` (ฟอร์มการ์ด)
- `src/Scripts_General.html` — `initTeachingMediaPage()` + `_mediaRender()` +
  `openMediaCardForm()` / `saveMediaCardForm()` / `deleteMediaCardPrompt()`
- `functions/mediaCards.js` — CRUD + กติกาการมองเห็น + allowlist ของ icon/สี/กลุ่มสาระ
- ตาราง `media_cards` (migration `db/migrations/2026-08-25-media-cards.sql`)
- `src/Scripts_Core.html` — `<li>` ในเมนู 3 จุด: ครูและแอดมินเป็น **เมนูย่อยท้ายกลุ่ม
  "ฝ่ายวิชาการ"** (`nav-link-sub`, สี `#00897b`) ส่วนนักเรียนเป็น `dept-btn` ระดับบน
  เพราะเมนูนักเรียนไม่มีกลุ่มฝ่าย · `PAGE_DEPT.Page_Teaching_Media = 'academic'` ·
  dispatch ใน `setupPageContent`

**กติกาการมองเห็น** (เทสต์อยู่ที่ `test/media_cards.test.js`):

- ครูและ Admin เห็นทุกใบ · นักเรียนเห็นเฉพาะใบที่ระดับชั้นตัวเองอยู่ใน `visible_levels`
- `visible_levels` ว่าง = **ครูเท่านั้น** และเป็นค่า default ตอนสร้างการ์ด — กันเฉลย
  กับข้อสอบหลุด ฟอร์มจะเตือนก่อนบันทึกถ้าครูไม่เลือกชั้น
- ⚠️ **กรองที่ SQL เสมอ** ห้ามส่งการ์ดที่นักเรียนไม่ควรเห็นออกไปแล้วซ่อนฝั่ง client
- ⚠️ **ระดับชั้นต้อง query สดจาก `users.department` ห้ามใช้ `user.dept` ใน JWT** —
  token อายุ 90 วัน เด็กเลื่อนชั้นแล้ว dept ค้างชั้นเก่าเกือบ 3 เดือน

**ความปลอดภัยของค่าที่ครูกรอก**:

- `icon` / `color` / `subject_group` ตรวจด้วย allowlist ใน `functions/mediaCards.js`
  ตัวเดียวกับที่ `getMediaCardOptions` ส่งไปสร้างฟอร์ม — เพิ่มตัวเลือกแก้ที่เดียว
- `url` รับเฉพาะ `http:` / `https:` (บล็อก `javascript:` และ `data:` ที่การ escape
  ฝั่ง client ช่วยอะไรไม่ได้)
- `_mediaCardEl()` สร้างการ์ดด้วย `createElement` + `textContent` ล้วน
  **ห้ามเปลี่ยนกลับไปต่อ HTML string** เพราะเนื้อหาการ์ดมาจากครูคนอื่น
- ปักหมุด (`is_featured`) เป็นของ Admin เท่านั้น ครูตั้งเองไม่ได้แม้ในการ์ดตัวเอง
- ครูแก้/ลบได้เฉพาะการ์ดที่ `created_by` เป็นตัวเอง · การกู้คืนจากถังขยะเป็น ADMIN_ONLY
- ลบเป็น soft delete (`deleted_at`) ไม่ใช่ลบจริง
- ปุ่ม "แชร์ไป Google Classroom" เปิด `https://classroom.google.com/share?url=...` ตรง ๆ
  **ไม่ได้โหลด widget `platform.js` ของ Google** — ไม่ต้องพึ่ง script ภายนอก ไม่ใช้ Classroom API
  ไม่ต้อง OAuth ไม่ต้อง verification · ขึ้นเฉพาะการ์ดแบบลิงก์ เพราะการ์ด PDF ใช้ลิงก์แบบมีตั๋ว
  อายุ 10 นาทีและผูกกับคนขอ แชร์ไปแล้วเปิดไม่ได้ · ทุกคนที่เห็นการ์ดกดแชร์ได้ ไม่จำกัดเจ้าของ

`MEDIA_SUBJECTS` ใน `Scripts_General.html` **ไม่ใช่แหล่งความจริงแล้ว** — เหลือหน้าที่เดียว
คือรายการสำรองตอน `getMediaCards` ล้มเหลว (ขึ้นแถบเตือน `#mediaFallbackWarn` คู่กัน
ไม่แสดงเงียบ ๆ เหมือนของจริง) แก้การ์ดจริงทำในหน้าเว็บ ไม่ต้อง deploy

- เว็บวิชาเป็น static site แยกโปรเจกต์ ไม่ได้อยู่ใน repo นี้ — อยู่ที่
  `../สื่อการสอน/<วิชา>/` deploy แยกบน Vercel เพราะ push `main` ของ repo นี้
  = deploy production ทันที ไม่ควรเอาเนื้อหาเรียนกับ PDF หลายสิบ MB มาปน
- ไอคอนในการ์ดใช้ `background: <สีวิชา>; color:#fff` ไม่ใช่สีอ่อน + ตัวอักษรสีเดียวกัน
  เพราะบน dark mode พื้นอ่อน 13% กับตัวอักษรสีเดิม contrast ต่ำจนอ่านไม่ออก
**การ์ดแบบ PDF (`card_type = 'pdf'`)**:

- ที่เก็บไฟล์อยู่หลัง adapter `lib/storage/` เลือกด้วย `STORAGE_DRIVER`
  `disk` (dev + เทสต์) / `s3` (production, Cloudflare R2) — เหตุผลที่ไม่ใช้ Drive,
  Railway Volume, หรือ Postgres bytea อยู่ในหัวไฟล์ `lib/storage/s3.js`
- **ตั้งค่าไม่ครบ = ปิดฟีเจอร์อัปโหลด** ไม่ใช่เขียนลงที่ชั่วคราวแล้วบอกว่าสำเร็จ
  (`uploadEnabled=false`, endpoint 503, Admin เห็นแถบสถานะ) — การ์ดลิงก์ต้องใช้ได้เสมอ
- **เปิดไฟล์**: `getMediaFileTicket` ตรวจ `visible_levels` แล้วให้ driver ออก URL อายุสั้น
  · `s3` → presigned URL 5 นาที เบราว์เซอร์โหลดจาก R2 ตรง **Railway ไม่แตะไฟล์**
  · `disk` → ตั๋ว JWT 10 นาที ชี้ `GET /api/media/file/:id?t=` ซึ่ง **mount เฉพาะ driver disk**
  ทั้งสองแบบตรวจสิทธิ์ตอน *ออก* URL ไม่ใช่ตอนเสิร์ฟ — `window.open` แนบ Authorization
  header ไม่ได้เพราะ JWT อยู่ใน localStorage ไม่ใช่ cookie
- `media_cards.url` ของการ์ด PDF **เป็นค่าว่างเสมอ** ลิงก์ออกใหม่ทุกครั้งที่ขอ
  (เก็บ presigned URL ที่หมดอายุใน 5 นาทีไว้ในตารางไม่มีความหมาย)
- **อัปโหลดผ่าน backend เสมอ** ทั้งสอง driver — `POST /api/media/upload` (`routes/media.js`)
  **เส้นแบ่งคือ binary ไป REST ที่เหลือไป `/api/gas`** · ยอมให้ byte วิ่งผ่าน Railway
  ตอนอัปเพราะเป็น write path นาน ๆ ครั้ง และต้องเห็นไฟล์ถึงจะตรวจ magic bytes ได้
- ด่านตรวจ: 25MB, MIME `application/pdf`, **magic bytes `%PDF-`** (ไม่เชื่อ MIME จาก client),
  rate limit 20 ไฟล์/ชม./คน — ตรวจ metadata ให้ครบ *ก่อน* เขียนไฟล์เสมอ
  ไม่งั้นได้ไฟล์กำพร้าที่กินพื้นที่โดยไม่มีแถวไหนชี้ถึง (insert ล้ม → ลบไฟล์ทิ้ง)
- ⚠️ **busboy ถอด `filename` เป็น latin1** ชื่อไฟล์ภาษาไทยจะเป็น mojibake ตั้งแต่รับเข้ามา
  `decodeFilename()` แปลงกลับ อย่าถอดออก
- ชื่อไฟล์ในที่เก็บเป็น hex สุ่มล้วน ไม่เอาชื่อที่ครูตั้งมาประกอบ (กัน path traversal
  และปัญหา encoding) — ทั้งสอง driver ตรวจซ้ำอีกชั้นแม้ค่าจะมาจาก DB
- `url` ของการ์ด PDF **แก้จากฟอร์มไม่ได้** — เปลี่ยนไฟล์ = ลบการ์ดแล้วอัปใหม่
- **ถังขยะ 30 วันอยู่ที่ `deleted_at` ที่เดียว ไม่แตะไฟล์**: ลบ = ไม่ทำอะไรกับ storage,
  กู้คืน = ล้าง `deleted_at` (จึงไม่มีทางกู้แล้วได้การ์ดที่เปิดไฟล์ไม่ได้)
  พ้น 30 วัน `purgeExpiredCards()` **ลบ object ก่อนแล้วค่อยลบแถว** — สลับลำดับเมื่อไหร่
  ได้ไฟล์กำพร้าที่ไม่มีอะไรชี้ถึงตลอดกาล · รันตอน boot ต่อจาก migration ไม่มี cron
- **1 bucket + 1 token ต่อ 1 โรงเรียน** จำกัด blast radius ตอน key หลุด — วิธีตั้งอยู่ใน `WEB_DEV.md`
- driver `s3` เป็น path ที่ production ใช้แต่เทสต์อัตโนมัติไม่ครอบ (ไม่มี R2 ตอนรันเทส)
  `test/storage.test.js` ล็อกเท่าที่ล็อกได้: การตรวจ key, รูปทรง presigned URL, การปิดตัวเองเมื่อ env ไม่ครบ
  **แก้ `lib/storage/s3.js` แล้วต้อง smoke test บน production จริง**

### งานสารบรรณ — สิทธิ์และไฟล์แนบ

⚠️ **ตัวตนมาจาก JWT เท่านั้น ห้ามรับ `userName`/`role`/`requester` จาก client**

เดิม `getSarabunHistory([userName, role])` รับมาจาก args แล้วเชื่อตรง ๆ และไม่อยู่ใน
allowlist ไหนเลย → ใครที่ล็อกอินได้ (รวมนักเรียน) ส่ง `role='TEACHER'` ก็อ่านทะเบียน
ทั้งโรงเรียนได้ · `saveSarabun` ก็รับ `requester` จาก client → สร้างเอกสารในนามคนอื่นได้

ตอนนี้:
- `getSarabunHistory` / `getSarabunFileTicket` อยู่ใน `TEACHER_OR_ADMIN` และอ่าน role จาก JWT
- `requester` มาจาก **`users.full_name` query สดจาก DB** ไม่ใช่ `user.name` ใน token
  (token อยู่ได้ 90 วัน ครูเปลี่ยนชื่อ-สกุลแล้วจะได้ชื่อเก่าติดเอกสารใหม่)
  Admin ระบุแทนคนอื่นได้ (ธุรการกรอกให้ครู) ครูทั่วไปเป็นตัวเองเสมอ
- **ครูและ Admin เห็นทุกรายการและเปิดไฟล์แนบได้หมด** — เป็นทะเบียนกลางของงานธุรการ
  **ไม่ใช่ที่เก็บเอกสารลับ** (เรื่องบุคคล เงินเดือน วินัย ไม่ควรแนบที่นี่)
  ถ้าวันหนึ่งต้องการจริง เพิ่มคอลัมน์ `confidential` + เงื่อนไขเดียวใน query

**ตัวกรองประเภท**: เลือกประเภทในฟอร์มขอเลข (`#docType`) จะตั้ง `#filterSarabunType`
ฝั่งขวาให้ตรงกันแล้วกรองทันที (`syncSarabunTypeFilter`) — ครูขอเลขประเภทไหนมักอยากดู
ของประเภทเดียวกันเพื่อเทียบเลขล่าสุด · ⚠️ ค่าใน `<option>` ของสอง select ต้องตรงกัน
แก้ที่ใดที่หนึ่งต้องแก้อีกที่ ไม่งั้นตัวกรองจะเงียบ ๆ ไม่ตรง (ประเภทที่ไม่รู้จัก → แสดงทั้งหมด
ดีกว่าโชว์ตารางว่าง)

**ไฟล์แนบ** — 1 ไฟล์ต่อ 1 ทะเบียน ใช้ `lib/storage/` ตัวเดียวกับสื่อการสอน:

- `POST /api/media/sarabun/:id` — **PDF / JPEG / PNG / DOCX** 10MB
  รับรูปเพราะครูถ่ายรูปหนังสือราชการด้วยมือถือเป็นปกติ บังคับให้แปลงเป็น PDF ก่อน
  = ครูกลับไปส่งไลน์เหมือนเดิม
- **`.docx` เท่านั้น ไม่รับ `.doc`/`.docm`** — .doc (OLE2) และ .docm เก็บ macro ได้
  ส่วน .docx เก็บไม่ได้ตามสเปก · เสิร์ฟเป็น `Content-Disposition: attachment`
  บังคับดาวน์โหลด ไม่ให้เบราว์เซอร์พยายามเรนเดอร์
- ชนิดตัดสินจาก **magic bytes** เท่านั้น (`lib/storage/types.js`) นามสกุลใน key
  มาจากผลตรวจนั้น ไม่ใช่จากชื่อไฟล์ที่ client ส่ง
- **แนบทับ**: อัปไฟล์ใหม่ให้สำเร็จก่อน แล้วค่อยลบของเก่า (ลบก่อนแล้วอัปพัง = เสียของเดิมฟรี)
- **ลบทะเบียน** (ADMIN_ONLY, hard delete): **ลบไฟล์ก่อนแล้วค่อยลบแถว** ลบไฟล์ไม่สำเร็จ
  = ไม่ลบแถว กันไฟล์กำพร้า · ไม่มีถังขยะ 30 วันแบบสื่อการสอนเพราะสารบรรณลบจริงอยู่แล้ว
- เปิดไฟล์ผ่าน `getSarabunFileTicket` → presigned URL (s3) หรือตั๋ว JWT (disk)
  ตั๋วผูกกับ `kind` + `id` ใช้ข้ามชนิดหรือข้ามเอกสารไม่ได้

`sarabun.file_url` (TEXT) เป็น legacy ไม่ได้ใช้แล้ว — `uploadSarabunFile` เคยเป็น stub
ที่คืน `status: 'success'` ทั้งที่ไม่เก็บไฟล์ คอลัมน์จึงควรว่างทั้งตาราง ลบทิ้งได้เมื่อยืนยัน

### ป้ายบนตาราง "จัดการเรียนรู้วันนี้" (dashboard ครู)

`renderTeacherTodaySchedule()` — **teal `#0f766e` = ประเภทคาบ** (สอนแทน / ชุมนุม,
ล้อการ์ด "คาบสอนแทนของฉัน" ที่ใช้ teal ทั้งใบ), **`bg-success` = สถานะ**
(สอนเสร็จแล้ว / เช็คชื่อแล้ว) ชุมนุมเคยเป็น `bg-success` แล้วชนกับป้ายสถานะ
จนอ่านเป็นเขียว 2 เฉดที่เพี้ยนกัน


---

## Historical Roster Fallback (`getStudentsByClass`)

เปลี่ยนปีย้อนหลัง → `users.year` ทับด้วย promote → ต้อง fallback chain:

```
1. users WHERE class=$c AND year=$y AND status='ปกติ'   (exact, current)
2a. (historical only) user_history WHERE action='promote'
       AND old_data->>'year'=$y AND old_data->>'department'=$c
       → DISTINCT ON (username) ORDER BY username, timestamp DESC
       (มี email/password ครบจาก snapshot)
2b. (historical only) DISTINCT a.student_id, a.student_name, a.class
       FROM attendance a LEFT JOIN users u ON u.username=a.student_id
       WHERE a.year=$y AND a.class=$c
       (fallback กรณีไม่เคย promote, ไม่มี email/password)
3. (current year only) users ignore year filter   (last resort)
```

### `promoteStudentsToNextYear()` snapshot
ก่อน UPDATE → INSERT 1 row ลง user_history:
```js
{ username, action:'promote', changed_by:'system',
  old_data: full row before,
  new_data: { ...row, department:newDept, year:newYear, status:newStatus } }
```
ปีถัดไปทุก batch promote จะมี snapshot ครบ → query ปีเก่าได้

---

## Write Function Return Format

Frontend เช็ค `res.status === 'success'` ทุก write function. คืน:
```js
{ status: 'success', message: 'ข้อความภาษาไทย' }
```
**ห้าม** `{ success: true }` หรือ `true` — frontend ไม่ตรวจ key เหล่านี้

ทุก error → catch → `res.json({ __error: err.message })` (handle โดย `routes/gas.js` dispatcher)

---

## Roles & Permissions

`users.role` ใน DB:
| Role | สิทธิ์ |
|---|---|
| `Admin` | ทุก endpoint, bypass permission checks |
| `Teacher` | เช็คชื่อ/คะแนน/ปพ.5 เฉพาะวิชาที่สอน (verify ผ่าน timetable); เห็นเอกสารสารบรรณทั้งหมด (เทียบเท่า Admin) |
| `Student` | ดูข้อมูลตัวเอง |
| `Executive` | read-only, dept-scoped |

เปรียบเทียบด้วย `String(role).trim().toUpperCase()` ทุกครั้ง

### Route-level authorization (`routes/gas.js`)

```js
ADMIN_ONLY    = Set{ addUser, editUser, deleteUser, importCSV, saveSystemConfig,
                     timetable admin writes, approveLeave, assignSubstitute,
                     getAutoAssignPreview, applyAutoAssign,
                     getAllUsers, promoteStudentsToNextYear, club admin, ... }
TEACHER_OR_ADMIN = Set{ saveAttendanceBatch, saveMassiveAttendanceGrid,
                        saveSubjectConfig, saveAllInOneScores, saveAllInOneWithConfig,
                        saveDetailedLessonRecord, saveMorningActivityBatch,
                        createClub, updateClub, saveLeaveRequest, ... }
```

Enforcement ก่อน handler ทุก request (ยกเว้น `PUBLIC_FNS`: `checkLogin`, `getSystemConfig`).

### `verifyTeacherOwnsSubject(user, subjectCode, className, term, year)` — `lib/permissions.js`

- Admin → ผ่านทันที
- `subjectCode='HR'` → ผ่านทันที (homeroom ผ่านทุก teacher)
- `subjectCode.startsWith('CLUB')` → query `club_advisors`
- อื่นๆ → query `timetable` (cached 5 min ต่อ teacherId+subjectCode+term+year)
- ถ้าระบุ `className` → ตรวจ level/room match ด้วย `_normalize()`

ทุก write function ที่ teacher เรียกต้องผ่านฟังก์ชันนี้ก่อน. Identity ใช้ `user.id` จาก JWT เท่านั้น — ห้ามใช้ teacherId จาก payload.

### Row-level ownership — ต้องเช็คแยกจาก subject-level

`verifyTeacherOwnsSubject` เช็คแค่ว่าครู "สอนวิชานี้ไหม" ไม่ได้เช็คว่า
"แถวนี้เป็นของครูคนนี้ไหม" write ที่รับ row id จาก client ต้องเช็คเพิ่ม:

| Helper | ตาราง | ใช้ที่ |
|---|---|---|
| `verifyAttendanceBatchOwner(user, rowIds)` | `attendance` | `updateAttendanceBatch`, `saveMassiveAttendanceGrid` (non-HR) |
| `verifyMorningBatchOwner(user, rowIds)` | `morning_activity` | `saveMassiveAttendanceGrid` (HR) |
| `verifySessionOwner(user, sessionId)` | `attendance` | `updateAttendanceStatus` |
| `verifyLessonRecordOwner(user, recordId)` | `detailed_lesson_records` | lesson record writes |

⚠️ **`subjectCode='HR'` ผ่าน `verifyTeacherOwnsSubject` ทันทีทุกครู** — HR path
จึงต้องพึ่ง row-level check 100% เคยพลาดมาแล้ว: `saveMassiveAttendanceGrid`
ข้าม ownership check ตอน `isHR` ทำให้ครูคนไหนก็แก้ homeroom ของครูคนอื่นได้

⚠️ **`DELETE ... WHERE session_id=$1` ต้อง scope ด้วย teacher_id เสมอ** —
`session_id` คำนวณจาก client input ล้วน (`date|morning|className`) ถ้าไม่ scope
ครูคนหนึ่งลบข้อมูลของอีกคนได้ ดู `saveMorningActivityBatch`

⚠️ **ห้ามเทียบ payload กับ payload** — `teacherUpdateTimetableRow` เคยเทียบ
`row.teacher_id` กับ `teacherId` ที่มาจาก payload (attacker คุมทั้งคู่) ต้องเทียบ
กับ `user.id` จาก JWT

**Handler ที่ต้องเช็ค identity ต้องรับ `user`** — `routes/gas.js` ส่ง
`(args, user)` ให้ handler แต่ handler ที่เขียนเป็น `(args) => fn(args)` จะทิ้ง
`user` ไปเงียบ ๆ แล้ว fallback ไปใช้ `payload.teacherId` แทน

### Ownership ต่อ resource (`TEACHER_OR_ADMIN` ทุกตัวต้องมี)

| Function | เจ้าของคือ | เช็คด้วย |
|---|---|---|
| `updateLeave` / `deleteLeave` | `leave_records.teacher_id` | `_assertOwnsLeave()` |
| `confirmSubstitute` | `substitute_assignments.sub_teacher_id` | UPDATE ... AND sub_teacher_id (rowCount=0 → throw) |
| `saveSubstituteAssignment` | — (INSERT) | `assigned_by` มาจาก JWT ไม่ใช่ payload |
| `updateClub` | `club_advisors` | `verifyTeacherOwnsSubject(user, 'CLUB_'+clubId, ...)` |
| `saveStudentRemarkDirectly` | `timetable` | `verifyTeacherOwnsSubject()` |

`createClub` ไม่เช็ค (ยังไม่มีเจ้าของ) — ครูคนไหนก็สร้างชุมนุมได้ตามออกแบบ

**`sarabun`** — ไม่มีคอลัมน์เจ้าของ ครูสร้าง/แก้/เห็นได้ทั้งหมด (เทียบเท่า Admin
ตามตาราง Roles) แต่ **`deleteSarabun` เป็น `ADMIN_ONLY`** เพราะตรวจสิทธิ์รายแถวไม่ได้

**`budgets`** — มี `created_by` แล้ว `saveBudget` เป็น upsert ตาม `project_id` จึงต้อง
เช็คก่อนทับ: เจ้าของหรือ Admin เท่านั้น แถวที่ `created_by` ว่าง (ข้อมูลก่อนเพิ่มคอลัมน์)
สงวนให้ Admin แก้

**Stub ที่ยัง no-op โดยตั้งใจ:** `updateTaskStatus` + `sendTaskToNotion` (Notion hook
เฉพาะ `teacher12` — todo จริง sync ผ่าน `getTodoList.save`; `sendTaskToNotion` ต้องคืน
**สตริง JSON** `'{}'` ไม่ใช่ object เพราะ frontend ทำ `JSON.parse(response)` แล้วอ่าน `.id`),
`uploadSarabunFile` (ไม่รองรับ upload ใน web)

### ช่องวันที่ — ต้องเซ็ตผ่าน `setDateValue()`

`applyThaiDatePickers()` (`Scripts_Core.html`) ครอบ `input[type="date"]` ทุกช่องด้วย
flatpickr แบบ `altInput: true` — flatpickr **ซ่อน input จริงแล้วสร้างช่องข้อความไทย
(พ.ศ.) มาโชว์แทน**

```js
setDateValue('subFilterFrom', '2026-08-17');   // ✅
document.getElementById('subFilterFrom').value = '2026-08-17';  // ❌ ช่องที่ครูเห็นไม่เปลี่ยน
```

เซ็ต `.value` ตรง ๆ ค่าจะเปลี่ยนจริง (logic ทำงานถูก) แต่ช่องที่ผู้ใช้เห็นยังโชว์ค่าเดิม —
เคยหลุดพร้อมกัน 11 จุด: ปุ่ม วันนี้/สัปดาห์นี้/สัปดาห์หน้า ของหน้าจัดสอนแทน, modal
เพิ่มคาบเอง, modal แก้ใบลา, ปฏิทิน, สารบรรณ

`setDateValue(id, val)` เรียก `el._flatpickr.setDate(val, false)` ให้ด้วย
(`false` = ไม่ยิง `onChange` — คนเรียกจัดการ reload เอง)

### ชื่อ RPC ต้องตรงกับ handlers map เป๊ะ

`routes/gas.js` ตอบ `'<fn>' not implemented in web prototype yet` เมื่อไม่เจอชื่อ —
เป็น error ตอน runtime อย่างเดียว ไม่มีอะไรจับตอน build เคยหลุดมาแล้ว 4 ตัว
(`submitLeaveRequest` ที่จริงชื่อ `saveLeaveRequest` ทำให้ครูแจ้งลาไม่ได้เลยตั้งแต่
commit แรกที่ย้าย `src/` เข้า repo, บวก `findDuplicateTimetableRows` /
`removeDuplicateTimetableRows` / `sendTaskToNotion` ที่ไม่มี backend เลย)

⚠️ อาการหลอก: ฟอร์มแจ้งลาขึ้น optimistic success ก่อนยิง API แล้วค่อย rollback
ตอน fail — ดูเหมือนบันทึกติดแล้วค่อยเด้งแดง

หา mismatch ทั้ง repo ด้วยการไล่ chain `google.script.run` (นับวงเล็บ ไม่ใช่ regex
หยาบ ๆ ไม่งั้นติด `.getElementById(` `.filter(` เต็มไปหมด) แล้วเทียบกับ key ใน
handlers map — ตัวปิด chain คือ method แรกที่ไม่ขึ้นต้นด้วย `with`

---

## Auth & Session

### Login flow
```
POST /api/gas/checkLogin  args:[username, password]
  → backend verify → response { __result: {status, id, name, role, dept}, __jwt }
  → frontend: localStorage.pssms_user = ผลลัพธ์
  →           localStorage.pssms_jwt  = jwt
```

### Subsequent calls
```
POST /api/gas/<fnName>
Authorization: Bearer <jwt>
```
`routes/gas.js` verify ก่อน dispatcher (skip `PUBLIC_FNS`)

### LocalStorage keys
- `pssms_user` — session object (90-day)
- `pssms_user_savedAt` — timestamp (ms) สำหรับ expiry check
- `pssms_jwt` — JWT token
- `pssms_creds` — `btoa(user:pass)` สำหรับ silent re-auth
- `pssms_last_page` — restore page on reload
- `pssms_theme` — light/dark
- `pssms_saved_accounts` — autofill dropdown

---

## Caching (`lib/cache.js`)

In-memory TTL cache (process-local, resets on restart). ใช้ `cache.get/set/del/delPrefix`.

| Cache key pattern | TTL | Invalidated by |
|---|---|---|
| `system_config` | 300s | — (manual restart) |
| `all_users_admin` / `all_users_redacted` | 60s | `USER_WRITE_FNS` |
| `tt_own_{teacherId}_{subjectCode}_{term}_{year}` | 300s | `TIMETABLE_WRITE_FNS` |
| `tt_date_{teacherId}_{dateStr}` | 60s | `TIMETABLE_WRITE_FNS` |
| `tt_status_{teacherId}_{dateStr}` | 60s | `TIMETABLE_WRITE_FNS` (รวม `saveAttendanceBatch`) |
| `students_{normClass}_{year}` | 300s | `USER_WRITE_FNS` |

Cache invalidation เกิดอัตโนมัติใน `routes/gas.js` หลัง handler สำเร็จ:
```js
TIMETABLE_WRITE_FNS → cache.delPrefix('tt_date_'), cache.delPrefix('tt_own_'), cache.delPrefix('tt_status_')
USER_WRITE_FNS       → cache.delPrefix('students_'), cache.del('all_users_*')
```

**ห้าม** cache ข้อมูลที่ vary ต่อ user role (เช่น admin vs teacher) ใน key เดียวกัน.

---

## DB Migrations

ไม่มี migration framework — ใช้ raw SQL ผ่าน `node -e` หรือ `psql` ตรง:
```bash
cd web
node -e "
require('dotenv').config();
require('./lib/db').query(\`
  ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT DEFAULT '';
\`).then(()=>{console.log('OK');process.exit();});
"
```

หลัง migration → restart server (`kill $(lsof -ti :3000); node server.js &`)

---

## Testing

`node:test` (built-in, ไม่มี dependency เพิ่ม) — เทสยิงผ่าน HTTP layer จริง
ทั้ง JWT verify, role check, ownership check เลยครอบด้วย

```bash
npm test                          # pretest reseed dev DB → รันทุกไฟล์ใน test/
npm run test:only test/scores.test.js
```

```
test/
├── helpers/api.js       boot app in-process (port 0) + call/ok/denied + tokens
├── helpers/fixtures.js  ค่าคงที่ที่ต้องตรงกับ db/seed-dev.js
├── permissions.test.js  auth, ADMIN_ONLY, ownership, admin bypass
├── substitute_timetable.test.js  คาบสอนแทนในตารางวันนี้ + สิทธิ์เช็คชื่อของครูสอนแทน
├── scores.test.js       ล้างคะแนน=ลบแถว, completeness gate, remark, leading zero
└── attendance.test.js   session overwrite, teacher_id จาก JWT, getSemesterReport
```

### กติกา

- **`npm test` reseed dev DB ทุกครั้ง** (`pretest` → `db/seed-dev.js`) — ข้อมูลที่กดเทสมือไว้บนหน้าเว็บหายหมด
- `test/helpers/api.js` ปฏิเสธรันถ้า `DATABASE_URL` ไม่ได้ชี้ localhost (parse hostname เหมือน seed) — เทสเขียน DB จริง
- `--test-concurrency=1` เพราะทุกไฟล์ใช้ DB เดียวกัน รันขนานแล้วชนกัน
- `server.js` export `app` และ listen เฉพาะตอน `require.main === module` — เทสจึงไม่ชนกับ dev server บน :3000
- ทุกไฟล์ต้อง `after(stop)` ไม่งั้น process ค้างเพราะ pg pool ยังเปิด
- แก้ `db/seed-dev.js` → แก้ `test/helpers/fixtures.js` ตาม

### เทส endpoint เดี่ยว ๆ แบบเร็ว (ไม่ต้องเขียนไฟล์เทส)

`/test-fn <fnName> [args...]` — ยิง admin JWT ไปที่ dev server บน :3000

---

## Conventions

- ปีการศึกษาเป็น **พ.ศ.** (2568, 2569) string ไม่ใช่ number
- เทอม: `"1"` หรือ `"2"` (string)
- ID เปรียบเทียบด้วย `String(x).trim()` เสมอ
- `normID(id)` — `String(id).replace(/[^a-zA-Z0-9]/g,'').replace(/^0+/,'') || '0'` (ใช้กับ student IDs)

⚠️ **รหัสนักเรียนมี 0 นำหน้าทุกคน (`01903`) — normID/parseInt ตัดทิ้ง (`1903`)**
ใช้ id ที่ตัดแล้วได้เฉพาะกับ **DOM element id** เท่านั้น (เลี่ยง selector พัง)
ส่วน **key ของ data map ที่มาจาก DB ต้องใช้ id ดิบเสมอ** เพราะ backend key ด้วย
`student_id` ตรง ๆ ผสมกันเมื่อไหร่ = lookup ไม่เจอ แล้ว fail เงียบ ไม่มี error

เคยพลาดมาแล้ว 2 ครั้ง:
- `saveMassiveGrid` lookup `attendance[cleanStdId]` → `origAtt` undefined ทุกแถว
  → ไม่ส่ง update เลย ครูกดบันทึกแล้วข้อมูลไม่เปลี่ยน แต่ขึ้น "บันทึกสำเร็จ"
- attendance report นับนักเรียนซ้ำเพราะ id ดิบกับ id ที่ normalize ปนกัน (commit `d25de40`)
- `normalize(str)` — keep Thai + alphanumeric only (ใช้กับ class names, subject codes match)
- ภาษาไทยทั้ง UI + error message
- Default admin: `admin` / `1234` — เปลี่ยนก่อน production
- **Never push** `.env`, `credentials.json`, service account JSONs

---

## Doc Update Rule

แก้ code → update doc พร้อมกันใน commit เดียว:
- Schema/migration → table section ในไฟล์นี้
- New endpoint → relevant section + frontend call example
- Function signature → "Function Signature Convention" examples list
- Bug fix ที่ behavior เปลี่ยน → conventions / relevant section

ห้าม split code commit กับ doc commit — กัน doc drift

---

## Karpathy-Inspired Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`NorthSKK/PSSMS-web`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — `CONTEXT.md` at root + `docs/adr/`. See `docs/agents/domain.md`.
