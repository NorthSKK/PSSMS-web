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
DATABASE_URL=postgresql://user:pwd@host:port/dbname
JWT_SECRET=long_random_string
PORT=3000
SPREADSHEET_ID=... (legacy — sheets.js ยังใช้สำหรับ migration ไม่ใช่ runtime)
```

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
| `budgets` | งบประมาณ |
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
{ ts, timetable, calendarEvents, riskDashboard, atRiskDashboard }
```
- `timetable` — today schedule (จาก `getTeacherTimetableWithStatus`)
- `calendarEvents` — 14-day strip
- `riskDashboard` — grade-based (0, ร, มส.) จาก `grade_summary` table — แสดงในการ์ด "นักเรียนกลุ่มเสี่ยง"
  - `LEFT JOIN users` (ไม่ใช่ INNER) — นักเรียนที่ promote/ลบไปแล้วต้องยังขึ้นการ์ด
  - ห้องเรียนเอาจาก `attendance.class` ของเทอมนั้น → snapshot ใน `user_history` → `users.department`
    (department ถูกทับตอน promote ใช้ได้เฉพาะปีปัจจุบัน)
- `atRiskDashboard` — attendance-based จาก `attendanceReport.getTeacherAtRiskDashboard` — แสดงใน "กระดานแจ้งเตือนกลุ่มเสี่ยง"

### ปุ่มคัดลอกรายชื่อส่ง LINE / Facebook

ทั้ง 2 การ์ดมีปุ่ม copy รายชื่อเป็น plain text ให้ครูส่งเข้าแชทนักเรียน:

| การ์ด | ฟังก์ชัน | จัดกลุ่มตาม | ปุ่มอยู่ที่ |
|---|---|---|---|
| นักเรียนกลุ่มเสี่ยง (เกรด) | `copyRiskListByClass(cls)` | ห้อง → วิชา → ประเภท (0/ร/มส) | header ของการ์ดแต่ละห้อง |
| กระดานแจ้งเตือน (เวลาเรียน) | `copyAtRiskList(bucket)` | วิชา+ห้อง | header ของ bucket ทั้ง 3 (`critical`/`ms`/`risk`) |

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

**ไม่มี ownership model โดยตั้งใจ:** `sarabun` (ครูเห็น/แก้ทั้งหมด เทียบเท่า Admin
ตามตาราง Roles), `budgets` (งานระดับฝ่าย) — ทั้ง 2 ตารางไม่มีคอลัมน์เจ้าของ

**Stub ที่ยัง no-op โดยตั้งใจ:** `updateTaskStatus` (Notion hook เฉพาะ
`teacher12` — todo จริง sync ผ่าน `getTodoList.save`), `uploadSarabunFile`
(ไม่รองรับ upload ใน web)

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

## Testing Endpoints

ไม่มี test framework — ทดสอบด้วย Node script ตรง:
```js
const jwt = require('jsonwebtoken');
const token = jwt.sign({id:'admin',role:'ADMIN'}, process.env.JWT_SECRET, {expiresIn:'1d'});
const http = require('http');
const body = JSON.stringify({args:[...]});
http.request({hostname:'localhost',port:3000,path:'/api/gas/fnName',
  method:'POST',headers:{'Content-Type':'application/json',
  'Content-Length':Buffer.byteLength(body),
  'Authorization':'Bearer '+token}}, res=>{...}).end(body);
```

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
