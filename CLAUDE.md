# PSSMS Web — Node + Railway PostgreSQL

ระบบบริหารจัดการสถานศึกษา 4 ฝ่าย โรงเรียนภูพระบาทวิทยา — **web rewrite** ของ GAS prototype เดิม (อ่าน `../src/` เป็น reference เท่านั้น, ไม่ deploy ไป GAS แล้ว).

พัฒนาโดย: ครูน๊อต ศิกษก เดินรีบรัมย์

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
│   ├── db.js                    PostgreSQL pool + query() helper
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

### `qualRecords` payload (frontend → backend)
```js
{ studentId, subjectCode, term, year,
  char1, char2, char3, char4, charTotal, char (=grade 0-3),
  read1, read2, read3, read4, readTotal, read (=grade 0-3) }
```
ห้ามใช้ `readingWriting/charJson/compJson` (ชื่อเก่า ผิด)

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
- `atRiskDashboard` — attendance-based จาก `attendanceReport.getTeacherAtRiskDashboard` — แสดงใน "กระดานแจ้งเตือนกลุ่มเสี่ยง"

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
| `Teacher` | เช็คชื่อ/คะแนน/ปพ.5 เฉพาะวิชาที่สอน (verify ผ่าน timetable) |
| `Student` | ดูข้อมูลตัวเอง |
| `Executive` | read-only, dept-scoped |

เปรียบเทียบด้วย `String(role).trim().toUpperCase()` ทุกครั้ง

### `verifyTeacherPermission(teacherId, subjectCode, className, term, year)`
Logic เดียวกับ GAS — query timetable row ที่ตรง 4 keys + `subjectCode='hr'` (homeroom) ผ่านอนุโลม + `CLUB_<id>` → query club_advisors แทน

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
