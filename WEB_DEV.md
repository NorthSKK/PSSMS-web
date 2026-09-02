# PSSMS Web — Developer Guide

คู่มือพัฒนา Web Prototype สำหรับโครงการ PSSMS  
Stack: **Node.js 24 + Express 4 + PostgreSQL (Railway)**

---

## Quick Reference

```bash
# Start dev server
npm run dev              # nodemon (auto-restart on change)
node server.js           # one-shot

# Kill & restart
kill $(lsof -ti :3000) 2>/dev/null; node server.js &

# เทส — TZ=UTC คือตัวที่จับบั๊กวันที่ที่เครื่อง dev มองไม่เห็น
npm test
TZ=UTC npm test

# ขึ้นเดโม → ขึ้นโรงเรียนจริง (คนละ branch โดยตั้งใจ)
git push origin main
git checkout production && git merge main && git push origin production && git checkout main

# Run migration SQL
node -e "
require('dotenv').config();
require('./lib/db').query(\`ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT\`)
  .then(() => { console.log('OK'); process.exit(); });
"
```

---

## 1. Prerequisites

| Tool | Version | ติดตั้ง |
|---|---|---|
| Node.js | 24+ | https://nodejs.org |
| npm | 10+ | มากับ Node |
| PostgreSQL client | any | `brew install postgresql` (สำหรับ psql) |

---

## 2. Setup (ครั้งแรก)

```bash
cd web/

# 1. ติดตั้ง dependencies
npm install

# 2. สร้างไฟล์ .env
cp .env.example .env
# แก้ไข .env ด้วย editor

# 3. รัน
npm run dev
# → http://localhost:3000
```

### .env ที่ต้องใส่

```env
DATABASE_URL=postgresql://localhost:5432/pssms_dev
JWT_SECRET=สตริงสุ่มยาวๆ_อย่างน้อย_32_ตัวอักษร
PORT=3000
```

> **JWT_SECRET** — generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### ตั้ง DB สำหรับ dev

`.env` **ชี้ Postgres ในเครื่องเสมอ ไม่ใช่ production** — เดิมชี้ Railway ตรง ๆ
ทำให้เทสทุกครั้งโดนข้อมูลครูจริง

```bash
brew install postgresql@18          # ต้องตรง major ของ prod
brew services start postgresql@18
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"   # keg-only
createdb pssms_dev

# schema จาก prod (ใช้ pg_dump สด ไม่ใช่ไฟล์ใน db/ ที่ค้างเก่า)
PROD=$(node -e "require('dotenv').config({path:'.env.prod'});process.stdout.write(process.env.DATABASE_URL)")
pg_dump --schema-only --no-owner --no-privileges "$PROD" | psql -q pssms_dev
pg_dump --data-only --no-owner --table=system_settings --table=curriculum --table=print_config "$PROD" | psql -q pssms_dev

node db/seed-dev.js                 # ข้อมูลปลอม — ปฏิเสธรันถ้าไม่ได้ชี้ localhost
```
login dev: `admin/1234`, `teacher1/1234`, `teacher2/1234`

**ห้ามก๊อปข้อมูลนักเรียนจริงลงเครื่อง** — `system_settings` ก๊อปได้เพราะไม่มี PII
และ massive grid auto-generate ตายถ้าไม่มี TermData

### ต่อ production (opt-in ต่อคำสั่ง)

URL จริงอยู่ใน `.env.prod` (gitignored) ไม่ใช่ `.env`

```bash
DATABASE_URL=$(node -e "require('dotenv').config({path:'.env.prod'});process.stdout.write(process.env.DATABASE_URL)") node db/backfill-grade-summary.js
```

เทสบน dev ไม่ต้องคืนค่าเดิม — แต่ถ้ารันด้วย `.env.prod` ต้องคืนทุกครั้ง

---

## 3. โครงสร้างไฟล์

```
web/
├── server.js                    Entry point — Express bootstrap
├── .env                         Secrets (gitignored)
├── .env.example                 Template (commit ได้)
│
├── lib/
│   ├── db.js                    PostgreSQL pool + query() helper
│   ├── cache.js                 In-memory TTL cache { get, set, del, delPrefix }
│   ├── permissions.js           isAdmin / adminOnly / adminOrExecutive / verify*Owner
│   ├── schoolDate.js            ⭐ "วันนี้" ตามเวลาไทย — ห้ามใช้ toISOString()/getDay() เอง
│   ├── sessionCalendar.js       คาบที่ควรสอน (pure ไม่แตะ DB)
│   ├── subjectGroup.js          subject_code → กลุ่มสาระ + isHomeroomSubject
│   ├── storage/                 ที่เก็บไฟล์ (disk / s3) เลือกด้วย STORAGE_DRIVER
│   └── sheets.js                Legacy Sheets client (migration เท่านั้น)
│
├── middleware/
│   └── auth.js                  JWT verify middleware (ใช้เฉพาะ route ที่ต้องการ)
│
├── routes/
│   ├── gas.js                   Main API — handlers map + JWT verify + dispatcher
│   └── assets.js                Serve GAS HTML → JS/CSS (strips script/style tags)
│
├── functions/                   Business logic (1 domain = 1 ไฟล์)
│   ├── checkLogin.js
│   ├── leave.js                 ใบลา + คาบสอนแทน (assign/unassign/manualCreateAffected)
│   ├── substituteAuto.js        จัดสอนแทนอัตโนมัติ (preview + apply)
│   ├── studentWatch.js          ⭐ ติดตามนักเรียน — classify() 4 อาการ อยู่ที่นี่ที่เดียว
│   ├── teacherProgressBoard.js  กระดานติดตามงานครู (**พักไว้ ติดป้ายกำลังพัฒนา**)
│   ├── missing.js               Catch-all สำหรับ functions เล็กๆ เยอะ
│   └── ... (ดูรายการครบด้านล่าง)
│
├── test/                        node:test — ยิงผ่าน HTTP layer จริง (ดูหัวข้อ Testing)
│   ├── helpers/api.js           boot app in-process + call/ok/denied + tokens
│   └── helpers/fixtures.js      ค่าคงที่ที่ต้องตรงกับ db/seed-dev.js
│
├── CONTEXT.md                   อภิธานศัพท์โดเมน — อ่านก่อนตั้งชื่ออะไรใหม่
├── docs/adr/                    การตัดสินใจที่ย้อนยาก + เหตุผล
├── docs/plan-*.md               แผนงานที่ตกลงแล้ว
│
├── public/
│   ├── index.html               SPA shell (compiled จาก GAS HTML)
│   └── gas-shim.js              google.script.run polyfill
│
└── db/
    ├── schema.sql               Full PostgreSQL schema (24 tables)
    ├── seed-dev.js              ข้อมูลปลอมสำหรับ dev (ปฏิเสธรันถ้าไม่ได้ชี้ localhost)
    ├── migrations/              raw SQL ที่รันไปแล้ว (ไม่มี framework)
    └── migrate-from-sheets.js   Migration script จาก Google Sheets (legacy)
```

---

## 4. Architecture

```
Browser → fetch POST /api/gas/<fnName>  { args: [...] }
                  Authorization: Bearer <jwt>
          ↓
     routes/gas.js
       ├─ JWT verify (ยกเว้น PUBLIC_FNS: checkLogin, getSystemConfig)
       ├─ lookup handlers[fnName]
       └─ call handler(args, user)
                  ↓
          functions/*.js  →  lib/db.js  →  Railway PostgreSQL
```

### gas-shim.js (Frontend Bridge)
```javascript
// GAS frontend เรียก:
google.script.run.withSuccessHandler(cb).fnName(a, b, c);

// gas-shim.js แปลงเป็น:
fetch('/api/gas/fnName', {
  method: 'POST',
  body: JSON.stringify({ args: [a, b, c] }),
  headers: { Authorization: 'Bearer <jwt>' }
})
// response: { __result: ... } หรือ { __error: '...' }
```

---

## 5. เพิ่ม Endpoint ใหม่

### Step 1 — เพิ่ม function ใน `functions/`

สร้างหรือแก้ไฟล์ที่เหมาะสม:

```javascript
// functions/myDomain.js
const { query } = require('../lib/db');

async function getMyData([teacherId, term, year]) {
  const { rows } = await query(
    `SELECT * FROM my_table WHERE teacher_id=$1 AND term=$2 AND year=$3`,
    [teacherId, term, year]
  );
  return rows.map(r => ({ id: r.id, name: r.name }));
}

async function saveMyData([data]) {
  const d = data || {};
  const { rows } = await query(
    `INSERT INTO my_table(name, term, year) VALUES($1,$2,$3) RETURNING id`,
    [d.name || '', d.term, d.year]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ', id: rows[0].id };
}

module.exports = { getMyData, saveMyData };
```

### Step 2 — ลงทะเบียนใน `routes/gas.js`

```javascript
const myDomain = require('../functions/myDomain');

// เพิ่มใน handlers object:
getMyData:   (args)       => myDomain.getMyData(args),
saveMyData:  (args, user) => myDomain.saveMyData(args, user),   // write ที่เช็คสิทธิ์ ต้องรับ user
```

**อย่าลืม allowlist ในไฟล์เดียวกัน** — สิทธิ์ตัดสินจาก **ชื่อฟังก์ชัน** ไม่ใช่จาก flag ใน payload:

| Set | ใคร |
|---|---|
| `ADMIN_ONLY` | Admin |
| `ADMIN_OR_EXECUTIVE` | Admin + ผอ./รอง (อ่านทั้งโรงเรียน แก้ไม่ได้) |
| `TEACHER_OR_ADMIN` | ครู + Admin |
| `PUBLIC_FNS` | ไม่ต้อง JWT |
| **`READONLY_ALLOWED`** | **ฟังก์ชัน *อ่าน* ทุกตัวต้องอยู่ที่นี่** — เป็น allowlist ลืมแล้วโรงเรียนที่ licence หมดอายุจะเปิดไม่ได้ |

### Step 3 — ทดสอบ

ยิงเร็ว ๆ ผ่าน dev server ที่รันอยู่ (สร้าง admin JWT ให้เอง):

```
/test-fn getMyData T001 1 2568
```

เขียนเทสจริงเมื่อ endpoint มีเรื่องสิทธิ์หรือ business rule — ดูหัวข้อ **Testing** ข้างล่าง

---

## 5.5 Testing

`node:test` (built-in ไม่มี dependency เพิ่ม) — เทสยิงผ่าน **HTTP layer จริง**
เลยครอบ JWT verify, role check, ownership check ไปด้วยในตัว

```bash
npm test                          # 174 ตัว · pretest reseed dev DB → รันทุกไฟล์ใน test/
TZ=UTC npm test                   # ⭐ อย่างน้อยหนึ่งรอบก่อน push — production รันเป็น UTC
npm run test:only test/scores.test.js
```

```js
const { ok, denied, stop } = require('./helpers/api');
after(stop);                                      // ไม่ปิด pool → process ค้าง

test('ครูเรียก ADMIN_ONLY ไม่ได้', async () => {
  const err = await denied('addUser', [{}], 'teacher1');
  assert.match(err, /ผู้ดูแลระบบ/);
});
```

**กติกา**

- `npm test` **reseed dev DB ทุกครั้ง** — ข้อมูลที่กดเทสมือไว้บนหน้าเว็บหายหมด
- `test/helpers/api.js` ปฏิเสธรันถ้า `DATABASE_URL` ไม่ได้ชี้ localhost (parse hostname
  ไม่ใช่ regex) — เทสเขียน DB จริง
- `--test-concurrency=1` เพราะทุกไฟล์ใช้ DB เดียวกัน
- แก้ `db/seed-dev.js` → แก้ `test/helpers/fixtures.js` ตาม
- seed ต้องคงรูปทรงข้อมูลจริง (รหัสนักเรียนมี 0 นำหน้า, ห้อง `ม.X/Y`, HR ครบ จ.-ศ.)
  ไม่งั้นบั๊กตระกูล normID จะไม่โผล่ตอนเทส

---

## 6. Function Signature Convention

**args เป็น array** — destructure เสมอ:

```javascript
// ✅ ถูก
async function fn([arg1, arg2, arg3]) { ... }

// ❌ ผิด — arg1 จะเป็น array ทั้งก้อน
async function fn(arg1, arg2, arg3) { ... }
```

ลำดับ args ต้องตรงกับ frontend call:
```javascript
// Frontend:
google.script.run.saveMyData(obj)
// → args = [obj]

// Backend:
async function saveMyData([obj]) { const d = obj || {}; ... }
```

### Return Format

**ทุก** write function:
```javascript
{ status: 'success', message: 'ข้อความภาษาไทย' }  // สำเร็จ
{ status: 'error',   message: 'สาเหตุ' }            // ผิดพลาด (throw แล้ว dispatcher จัดการ)
```

> **อย่า** return `true` / `{ ok: true }` — frontend เช็ค `res.status === 'success'`

---

## 7. Database

### Query Helper

```javascript
const { query } = require('../lib/db');

// Basic
const { rows } = await query('SELECT * FROM users WHERE username=$1', ['admin']);

// Insert RETURNING
const { rows } = await query(
  'INSERT INTO my_table(col) VALUES($1) RETURNING id',
  [value]
);
const newId = rows[0].id;

// Upsert
await query(`
  INSERT INTO config(key, subkey, value1) VALUES($1,$2,$3)
  ON CONFLICT (key, subkey) DO UPDATE SET value1=$3
`, [key, subkey, value]);
```

### In-memory Cache

```javascript
const cache = require('../lib/cache');

// Get
const data = cache.get('my_key');
if (data) return data;

// Set (TTL in seconds)
cache.set('my_key', result, 300); // 5 min

// Invalidate
cache.del('my_key');
cache.delPrefix('leave_');  // ลบทุก key ที่ขึ้นต้นด้วย 'leave_'
```

### Migrations

รันเองตอน server boot — `db/migrate.js` ไล่ไฟล์ใน `db/migrations/` ที่ยังไม่เคยรัน
เทียบกับตาราง `schema_migrations` **ไม่ต้องสั่งมือ deploy แล้ว migrate เอง**

จำเป็นเพราะขายแบบ 1 โรงเรียน = 1 deployment + 1 DB — รันมือไหวแค่ตอนมีโรงเรียนเดียว

```bash
node db/migrate.js     # รันตรง ๆ ก็ได้ (dev / ตรวจสอบ)
```

**เขียน migration ใหม่:**

1. สร้าง `db/migrations/YYYY-MM-DD-ชื่อ.sql` (ชื่อเรียงตามตัวอักษร = เรียงตามเวลา)
2. ⚠️ **แก้ `db/schema.sql` ให้ตรงกันด้วยเสมอ** — DB เปล่าของโรงเรียนใหม่สร้างจาก
   `schema.sql` แล้ว baseline migration ทั้งกอง ไม่ได้ไล่รันทีละไฟล์
   ถ้าลืม โรงเรียนใหม่จะได้ schema ที่ขาดของ (เคยหลุดจริงกับ FK ของ `substitute_assignments`)
   มีเทสต์ดักไว้แล้วที่ `test/migrate.test.js`
3. push — ทุก deployment จะ migrate เองตอน deploy

**พฤติกรรมของตัวรัน:**

| สภาพ DB | ทำอะไร |
|---|---|
| เปล่า (ไม่มีตาราง `users`) | รัน `schema.sql` แล้วบันทึกทุกไฟล์เป็น baseline |
| มีข้อมูลแต่ยังไม่มี `schema_migrations` | บันทึกทุกไฟล์เป็น baseline (DB ที่ migrate มือมาก่อน) |
| ปกติ | รันเฉพาะไฟล์ที่ยังไม่มีใน `schema_migrations` |

- แต่ละไฟล์รันใน transaction เดียว พังกลางทาง = rollback ไม่เหลือ schema ครึ่ง ๆ
- `pg_advisory_lock` กันสอง instance รันชนกันตอน deploy
- **migration พัง = เซิร์ฟเวอร์ไม่ขึ้น** โดยตั้งใจ แอปที่ขึ้นมาพร้อมตารางผิดรูปแย่กว่าแอปที่ไม่ขึ้น

### ชุดข้อมูลสำหรับถ่ายภาพหน้าจอ

```bash
node db/seed-demo.js      # ชื่อไทยสมจริงแต่สมมติ + โรงเรียนสมมติ + สื่อ/สารบรรณหลายรายการ
node db/seed-dev.js       # กลับไปข้อมูล dev ปกติ
```

ใช้ถ่ายภาพไปลงเว็บขาย (repo `pssms-site`) — `seed-dev` จงใจใส่คำว่า "ทดสอบ/ทดลอง"
ในชื่อคน ซึ่งพอไปโผล่ในภาพโฆษณาแล้วทำลายความน่าเชื่อถือ

⚠️ **ห้ามถ่ายภาพจาก production** เป็นข้อมูลครูและนักเรียนจริง ต้องขออนุญาต
และการเบลอพลาดครั้งเดียวคือข้อมูลนักเรียนหลุด

⚠️ ชื่อคนถูก**คัดลอกเป็นข้อความ**ไว้ในหลายตาราง (`attendance.student_name`,
`substitute_assignments.*_teacher_name`, ฯลฯ) ไม่ได้ join จาก `users` —
`seed-demo` มีรายการ `NAME_COPIES` ไล่ sync ให้ **เพิ่มตารางใหม่ที่เก็บชื่อซ้ำต้องเพิ่มในนั้นด้วย**
ไม่งั้นภาพจะมีชื่อเก่ากับชื่อใหม่ปนกัน (เคยหลุดมาแล้วบนแดชบอร์ด)

### Reset ข้อมูล (dev เท่านั้น)

```bash
node db/seed-dev.js      # ล้างตารางข้อมูลแล้วใส่ของปลอมชุดเดิม
```

`system_settings` / `curriculum` / `print_config` ไม่ถูกล้าง — ก๊อปมาจาก prod ตอน setup
(ไม่มี PII และ **massive grid auto-generate ตายถ้าไม่มี TermData**)

⚠️ **ห้ามก๊อปข้อมูลนักเรียนจริงลง dev** — seed ปฏิเสธรันถ้า `DATABASE_URL` ไม่ได้ชี้ localhost

---

## 8. Schema Summary (24 tables)

ดู `db/schema.sql` สำหรับ full definition. ตารางสำคัญ:

| Table | Primary Key | หมายเหตุ |
|---|---|---|
| `users` | `username` | role: Admin/Teacher/Student/Executive |
| `system_settings` | `(key, subkey)` | active term/year + TermData |
| `timetable` | `id` | level+room แยก (`ม.4` + `1` → `ม.4/1`) |
| `attendance` | `id` | class = combined `ม.X/Y` |
| `leave_records` | `id` | status: รอพิจารณา/อนุมัติ/ปฏิเสธ |
| `substitute_assignments` | `id` | status: รอจัด/จัดแล้ว/ยืนยันแล้ว |
| `subject_config` | `(subject_code, class_name, term, year)` | |
| `score_database` | `(student_id, subject_code, indicator_id, term, year)` | score เป็น TEXT |
| `clubs` | `club_id` | format `CLUB${Date.now()}` |

---

## 9. Auth & JWT

### Login Response
```
POST /api/gas/checkLogin
Body: { args: ['username', 'password'] }

Response: { __result: { status, id, name, role, dept }, __jwt: '...' }
```

Frontend เก็บ JWT ใน `localStorage.pssms_jwt`

### Protected Endpoint
ทุก request ส่ง header:
```
Authorization: Bearer <jwt>
```

`routes/gas.js` verify อัตโนมัติ — `user` object พร้อมใช้ใน handler:
```javascript
handlers['myFn'] = (args, user) => {
  if (user.role !== 'Admin') throw new Error('ไม่มีสิทธิ์');
  return myFn(args);
};
```

### Public Functions (ไม่ต้อง JWT)
```javascript
// routes/gas.js
const PUBLIC_FNS = new Set(['checkLogin', 'getSystemConfig']);
```

เพิ่ม function ลง Set เพื่อข้าม auth check

---

## 10. เพิ่มหน้าใหม่ (Frontend)

> Frontend อ่าน HTML จากไฟล์ `src/` (GAS prototype) — `routes/assets.js` serve เป็น JS/CSS

### Step 1 — สร้าง Page template

แก้ไขหรือสร้างไฟล์ใน `../src/Page_MyPage.html`

### Step 2 — เพิ่ม init dispatch

ใน `../src/Scripts_Core.html` ฟังก์ชัน `setupPageContent`:
```javascript
if (pageName === 'Page_MyPage') initMyPage();
```

> `innerHTML` ไม่ execute `<script>` — ต้องเรียก init แบบ explicit

### Step 3 — เพิ่ม JS

ใน `../src/Scripts_General.html` หรือไฟล์ที่เหมาะสม:
```javascript
function initMyPage() {
  var user = getSessionUser();
  if (!user) return;
  google.script.run
    .withSuccessHandler(function(data) { ... })
    .withFailureHandler(function(err) { showToast(err.message, 'danger'); })
    .getMyData(user.id, user.currentTerm, user.currentYear);
}
```

### Step 4 — เพิ่มใน Sidebar

ใน `../src/Scripts_Core.html` ฟังก์ชัน `renderApp(user)` — **ไม่มีฟังก์ชัน `buildMenu` และไม่มี array config
ของเมนู** เมนูสร้างด้วย template string ต่อกันเข้า `menuHTML` แล้วยัดเข้า `#menu-list` ตอนท้าย
role gating คือ `if (role === ...)` ธรรมดา ให้เพิ่ม `<li>` ในสาขา role ที่ควรเห็นเมนูนั้น:

```javascript
menuHTML += `<li class="mb-2"><a href="javascript:void(0)" class="dept-btn" style="border-left-color: #00897b !important;" onclick="loadPage('Page_MyPage')"><i class="fas fa-file" style="color: #00897b;"></i> <span>หน้าใหม่</span></a></li>`;
```

รูปแบบ markup ที่ใช้อยู่มี 3 ระดับ:
- **เมนูหลัก** — `<li class="mb-3"><a class="nav-link-custom active" onclick="loadPage('X')">`
- **หัวข้อฝ่าย** — `<div class="menu-divider">ชื่อกลุ่ม</div>` และ `<div class="dept-btn academic">` (คลิกไม่ได้)
- **เมนูย่อย** — `<li class="mb-1"><a class="nav-link-sub py-1" style="font-size:0.85rem;color:#...">`

อย่าลืมเพิ่ม `PAGE_DEPT['Page_MyPage']` ถ้าต้องการให้หน้าใช้ธีมสีของฝ่าย และเพิ่ม
`if(pageName === 'Page_MyPage') initMyPage();` ใน `setupPageContent` เพราะ `innerHTML` ไม่รัน `<script>` ในไฟล์ page

### Shared UI helper — แถบความคืบหน้าภาคเรียน

อยากได้แถบ "ภาคเรียนที่ 1/2569 · สัปดาห์ที่ 15/20 · 66%" บนหน้าไหน ใส่ div เปล่า
แล้วเรียกตัว render — สร้าง markup ให้เองทั้งหมด:

```html
<div id="myTermProgress" class="mb-3 d-none"></div>
```
```javascript
renderTermProgressBar('myTermProgress');        // ยิง getSystemConfig เอง
renderTermProgressBar('myTermProgress', cfg);   // มี systemConfig จาก bundle แล้ว
```

นิยามอยู่ใน `src/Scripts_Calendar.html` (โหลดทุก role) — รายละเอียดกติกาดู
`CLAUDE.md` หัวข้อ "แถบความคืบหน้าภาคเรียน"

---

## 11. Deploy (Railway)

**push ขึ้น `main` = deploy production ทันที** — Railway auto-deploy จาก GitHub
https://pw.pssms.app · ครูใช้จริง ไม่มี staging

**โครงโดเมน** (จดไว้แล้ว ยังไม่ได้ชี้ทั้งหมด):

| โดเมน | ชี้ไปไหน | สถานะ |
|---|---|---|
| `pssms.app` | เว็บขาย (repo `pssms-site` บน Cloudflare Workers) | ✅ ใช้งานแล้ว |
| `pw.pssms.app` | ภูพระบาทวิทยา (Railway) | ✅ ใช้งานแล้ว |
| `<โรงเรียน>.pssms.app` | โรงเรียนถัดไป ตั้งชื่อย่อแบบเดียวกัน | — |

โดเมนหลักเป็นของ **ผลิตภัณฑ์** ไม่ใช่ของโรงเรียนแรก — ภูพระบาทคือลูกค้ารายที่ 1
เปิดโรงเรียนใหม่: Railway → service → Settings → Networking → Custom Domain → `<ชื่อย่อ>.pssms.app`
แล้วเพิ่ม CNAME ตามที่ Railway บอกใน Cloudflare DNS

**URL เดิม `pssms-web-production.up.railway.app` ยังใช้ได้อยู่** เข้าได้ทั้งสองทาง
ไม่ต้องรีบให้ครูเปลี่ยน bookmark

รอ build ~1-2 นาที แล้วเช็คว่าโค้ดใหม่ขึ้นจริงด้วยการ grep asset ที่เสิร์ฟอยู่:

```bash
until curl -s https://pw.pssms.app/api/assets/script/Scripts_General \
  | grep -q "<ชื่อฟังก์ชันใหม่>"; do sleep 10; done; echo DEPLOYED
```

⚠️ `.env.prod` มีแค่ `DATABASE_URL` ที่ตรงกับ production — **`JWT_SECRET` ไม่ตรง**
กับที่ตั้งไว้บน Railway จึงใช้ mint token ยิง API production ไม่ได้

### ที่เก็บไฟล์สื่อการสอน (อัปโหลด PDF)

เลือก driver ด้วย `STORAGE_DRIVER` — `lib/storage/`

| driver | ใช้ตอนไหน | ที่เก็บ |
|---|---|---|
| `disk` (default) | dev + รันเทสต์ | ดิสก์ที่ `MEDIA_STORAGE_DIR` |
| `s3` | production | object storage ที่พูด S3 API (ตั้งใจใช้ Cloudflare R2) |

ทำไมไม่ใช้ดิสก์บน production: Railway ไม่มีดิสก์ถาวรให้ service
ทำไมไม่ใช้ Google Drive: publish OAuth เป็น production ต้องยืนยันโดเมน ซึ่ง
`*.up.railway.app` เป็นของ Railway และถ้าค้างโหมด Testing token หมดอายุทุก 7 วัน
ทำไมไม่ใช้ Postgres `bytea`: ระบบนี้ขายหลายโรงเรียน ไฟล์ใน DB ทำให้ restore ช้า
ตอนที่อยากให้เร็วที่สุด และ blob 25MB จองการเชื่อมต่อจาก pool ที่มีแค่ 20 ตัว

**ไม่ตั้งค่าให้ครบ = ปิดฟีเจอร์อัปโหลด** (ฟอร์มปิดตัวเลือก, endpoint ตอบ 503,
Admin เห็นแถบ "อัปโหลด PDF: ปิดอยู่") — การ์ดแบบลิงก์ใช้ได้ตามปกติเสมอ

#### ตั้งค่า R2 ให้โรงเรียนใหม่

**1 bucket + 1 token ต่อ 1 โรงเรียน** — token หลุดจากโรงเรียนหนึ่งต้องไม่เห็นไฟล์ของอีกโรงเรียน

1. Cloudflare Dashboard → **R2** → **Create bucket** → ตั้งชื่อ `pssms-<ชื่อโรงเรียน>`
   Location เลือก **APAC** · **ห้ามเปิด Public access** (ไฟล์เข้าถึงผ่าน presigned URL เท่านั้น)
2. **R2 → Manage API Tokens → Create API Token**
   - Permission **Object Read & Write**
   - **Specify bucket** → เลือกเฉพาะ bucket ของโรงเรียนนั้น ← สำคัญ อย่าเลือก "All buckets"
   - คัดลอก **Access Key ID** กับ **Secret Access Key** (โชว์ครั้งเดียว)
3. Railway → service ของโรงเรียนนั้น → **Variables**:

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_BUCKET=pssms-<ชื่อโรงเรียน>
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
```

`<account_id>` อยู่ที่หน้า R2 Overview มุมขวา

4. Redeploy → ล็อกอินเป็น Admin → หน้าสื่อการสอน แถบสถานะต้องขึ้น
   `ที่เก็บไฟล์: ปกติ (s3)` ถ้าขึ้นแดงให้ดูข้อความต่อท้าย บอกว่าติดตรงไหน

#### ใช้กับอะไรบ้าง

| จุด | ชนิดไฟล์ | ขนาด |
|---|---|---|
| การ์ดสื่อการสอน (`POST /api/media/upload`) | PDF | 25MB |
| ไฟล์แนบสารบรรณ (`POST /api/media/sarabun/:id`) | PDF / JPEG / PNG / DOCX | 10MB |

ชนิดไฟล์ตัดสินจาก magic bytes ใน `lib/storage/types.js` — เพิ่มชนิดใหม่แก้ที่ไฟล์เดียว

#### กลไกที่ควรรู้

- **เปิดไฟล์**: `getMediaFileTicket` ตรวจ `visible_levels` แล้วคืน URL อายุสั้น —
  driver `s3` คืน presigned URL (5 นาที) ให้เบราว์เซอร์โหลดจาก R2 ตรง **Railway ไม่แตะไฟล์เลย**
  driver `disk` คืนตั๋ว JWT ชี้ `GET /api/media/file/:id?t=...` ซึ่ง **mount เฉพาะ driver disk**
- **อัปโหลด**: ผ่าน backend เสมอ (ทั้งสอง driver) เพื่อคงการตรวจ magic bytes `%PDF-`
  ขนาด 25MB และ rate limit — upload เป็น write path เกิดนาน ๆ ครั้ง ไม่คุ้มที่จะเลี่ยง
- **ถังขยะ 30 วัน อยู่ที่ DB ไม่ใช่ที่ storage**: ลบการ์ด = ไม่แตะไฟล์, กู้คืน = ล้าง `deleted_at`
  พ้น 30 วัน `purgeExpiredCards()` ลบ object ก่อนแล้วค่อยลบแถว (ลบแถวก่อน = ไฟล์กำพร้า)
  เรียกตอน boot ต่อจาก migration ไม่ต้องมี cron
- **เปลี่ยนผู้ให้บริการ** (B2 / MinIO / S3 จริง) = แก้ `S3_ENDPOINT` กับ key ไม่ต้องแตะโค้ด

### Environment Variables ที่ต้องตั้งใน Railway
| Key | หมาย |
|---|---|
| `DATABASE_URL` | Railway จัดให้อัตโนมัติเมื่อ add PostgreSQL service |
| `JWT_SECRET` | random string — ตั้งครั้งแรกแล้วอย่าเปลี่ยน (invalidates all sessions) |
| `PORT` | Railway inject อัตโนมัติ — ไม่ต้องตั้ง |

### Healthcheck
Railway ใช้ HTTP check — server.js ตอบ `200` ทุก GET request (SPA fallback)

### Database Connection
`lib/db.js` เลือก SSL อัตโนมัติจาก hostname — `localhost` → ปิด, ที่เหลือ → เปิด
(`ssl: { rejectUnauthorized: false }`) จึงใช้ไฟล์เดียวได้ทั้ง dev และ prod

---

## 12. Conventions

| เรื่อง | Convention |
|---|---|
| ปีการศึกษา | พ.ศ. string `"2568"` — ไม่ใช่ ค.ศ., ไม่ใช่ number |
| เทอม | string `"1"` หรือ `"2"` |
| User ID | เปรียบเทียบด้วย `String(x).trim()` เสมอ |
| Class name | `ม.4/1` format — normalize ด้วย `str.replace(/[^a-zA-Z0-9ก-๙]/g,'')` |
| Role compare | `String(role).trim().toUpperCase()` |
| ภาษา UI | ภาษาไทยทั้งหมด |
| Field names | `teacherName` ไม่ใช่ `staffName`, `leaveId` ไม่ใช่ `id` (ดู getLeaveBundle.js) |
| Identity | ใช้ `user.id` จาก JWT เท่านั้น — **ห้ามเชื่อ teacherId ที่มากับ payload** |
| Permission | `ADMIN_ONLY` / `TEACHER_OR_ADMIN` ใน `routes/gas.js` + ownership รายแถวใน `lib/permissions.js` |
| Doc | แก้ code → แก้ `CLAUDE.md` **ใน commit เดียวกัน** (กัน doc drift) |

---

## 13. Common Pitfalls

| ปัญหา | สาเหตุ | วิธีแก้ |
|---|---|---|
| Function signature shift | args destructure ผิดลำดับ | ตรวจ frontend call ให้ตรงกับ backend signature |
| `res.status === 'success'` ไม่ match | return `true` / `{ok:true}` | ใช้ `{ status: 'success', message: '...' }` |
| Frontend ไม่ init | `<script>` ใน innerHTML ไม่ run | เพิ่ม explicit init call ใน `setupPageContent` |
| onclick แตก | `JSON.stringify(name)` ใส่ `"` ใน attribute | ใช้ single quote + escape `'` ด้วย `&#39;` |
| Field name mismatch | GAS vs web return ต่างชื่อ | ใช้ fallback `r.leaveId \|\| r.id` หรือ unify |
| PostgreSQL ambiguous column | JOIN หลายตารางมี column ชื่อเดียวกัน | qualify ด้วยชื่อตาราง `t.year` |
| Cache stale | ลืม invalidate หลัง write | เรียก `cache.del()` / `cache.delPrefix()` ทุก write path |
| `__error` in response | handler throw / return error | ดู console server + ข้อความใน `__error` |
| **บันทึกแล้วข้อมูลไม่เปลี่ยน แต่ขึ้น "สำเร็จ"** | lookup data map ด้วย id ที่ตัด 0 นำหน้า (`parseInt`/`normID`) ขณะที่ map key ด้วย id ดิบ | id ที่ตัดแล้วใช้ได้เฉพาะ **DOM element id** — key ของ data map ต้องใช้ id ดิบเสมอ |
| **ล้างค่าแล้วค่าเก่ากลับมา** | write function กรองค่าว่างทิ้งก่อนเขียน | ค่าว่างต้อง `DELETE` แถว ไม่ใช่ข้าม (ดู `_writeScoreRows`) |
| **หัวตารางขาวโพลน / ตัวหนังสือหาย** | `#page-content .table thead th` บังคับ `background:transparent !important` + `color:text-muted` specificity สูง | ใส่ `!important` + specificity ให้ชนะ (ดู `#scoreTableHeader`) |
| **แถว sticky ที่ 2 เลื่อนไปทับแถวแรก** | rule ที่ตั้ง `top:0` มี specificity สูงกว่า rule ที่ตั้ง offset | prefix ให้ specificity เท่ากันแล้วใส่ `!important` ที่ `top` |
| ปุ่มกดแล้วเงียบ ไม่มี error | `querySelector` หาปุ่มด้วย class ที่เปลี่ยนไปตอน restyle → `null` → throw ใน callback | อ้างปุ่มด้วย `id` ตายตัว ไม่ใช่ class ที่เป็นสไตล์ |
| Handler ไม่รู้ว่าใครเรียก | ลงทะเบียนเป็น `(args) => fn(args)` ทิ้ง `user` | ต้องเป็น `(args, user) => fn(args, user)` ทุก write ที่ต้องเช็คสิทธิ์ |
| `subjectCode='HR'` ผ่าน permission ทุกครู | `verifyTeacherOwnsSubject` ปล่อย HR ผ่านโดยตั้งใจ | HR ต้องเช็ค ownership ระดับแถวเอง (`verifyMorningBatchOwner`) |
| **`'<fn>' not implemented in web prototype yet`** | ชื่อ RPC ที่ frontend เรียก ไม่ตรง key ใน handlers map — ไม่มีอะไรจับตอน build | ไล่ chain `google.script.run` เทียบกับ handlers map (ตัวปิด chain คือ method แรกที่ไม่ขึ้นต้นด้วย `with`) |
| **ตั้งค่าช่องวันที่แล้วช่องที่ผู้ใช้เห็นไม่เปลี่ยน** | flatpickr ครอบ `input[type=date]` แบบ `altInput` — ซ่อน input จริงแล้วโชว์ช่องไทยแทน | ใช้ `setDateValue(id, val)` เสมอ. inline `onchange` ของ date input ก็ **ไม่ยิง** เพราะ flatpickr เซ็ต `.value` เอง |
| **ไฟล์ `src/*.html` ถูกตัดกลางคัน** | มี `</script>` อยู่ในสตริง JS — `routes/assets.js` strip ด้วย regex | เขียนเป็น `<\/script>` |
| **พิมพ์ออกมาผิดทิศ / โดนตัดขอบ** | `@page` อยู่ในเอกสารใน iframe — Chrome ใช้ page description ของ **main frame** ตอนพิมพ์จาก subframe | ประกาศ `@page` ที่ `document.head` ของ SPA ด้วย แล้วถอดออกตอนปิด (ดู `subPrintDone`) |
| **batch write เขียนทับกันเอง** | `Promise.all` ทำให้ทุกแถวอ่านสถานะก่อนที่แถวก่อนหน้าจะ commit | วน `for...of` ตามลำดับ + guard `WHERE ... AND status='<เดิม>'` |
| **ตัวเลือกใน dropdown เปลี่ยน แต่แถวเก่ากรองไม่เจอ** | คอลัมน์เก็บ label เป็นสตริงตรง ๆ (เช่น `leave_records.type`) | เปลี่ยน option แล้วต้อง UPDATE แถวเก่าใน DB ด้วย |
| **การ์ดหายทั้งใบทั้งที่ render สำเร็จ** | ไป render ลง container ที่ตัวอื่นสั่ง `d-none` ตอนไม่มีข้อมูล (เช่น `#dashCalendarStrip`) | วาง container ของตัวเองไว้นอก strip ที่ถูก toggle |
| **ตัวเลขบนบรรทัดเดียวกันชนกันจนอ่านไม่ออก** | คั่นด้วย margin utility (`ms-2`) ล้วน ไม่มีตัวอักษรคั่น | ใส่ separator จริง (`·`) — margin หายตอน copy และช่องไฟบางเกินบนจอ |
| **โมดัลเปิดมาแล้วค้างที่ skeleton ไม่มี error** | อ้าง `user.xxx` ลอย ๆ — **ไม่มี global ชื่อ `user`** ในระบบนี้ · throw ก่อนที่ `google.script.run` จะถูกผูก failure handler เลยไม่มีอะไรแสดง | เรียก `getSessionUser()` เองในทุกฟังก์ชัน |
| **ฟังก์ชันหายไปเฉย ๆ กลายเป็น `undefined`** | `Scripts_*.html` ทุกไฟล์อยู่ใน **global scope เดียวกัน** — `var x` ทับ `function x` ที่ประกาศไว้ก่อนตอนโหลดสคริปต์ | อย่าตั้งชื่อตัวแปรซ้ำกับฟังก์ชัน (เคยหลุด: `var _swRank` ทับ `function _swRank`) |
| **class/style ของช่องวันที่ไม่มีผล** | flatpickr `altInput` สร้าง input **ตัวใหม่** ให้ class จาก `altInputClass` เท่านั้น ไม่ก๊อปจากตัวเดิม ไม่ก๊อป `style` | `applyThaiDatePickers()` ส่งต่อให้แล้ว — **แก้ที่นั่นที่เดียว อย่าไล่แก้ทีละหน้า** · ช่องที่เห็นมี class `flatpickr-alt` |
| **เปิดระบบเช้ามืดแล้วเห็นข้อมูลของเมื่อวาน** | `toISOString()` ให้วัน UTC · `getDay()/getFullYear()` ใช้ TZ ของ process ซึ่งบน Railway คือ **UTC** (เครื่อง dev เป็นเวลาไทยจึงผ่านเสมอ) | ใช้ `lib/schoolDate.js` — `schoolToday()` / `schoolDateStr()` / `schoolDayIndex()` · รัน `TZ=UTC npm test` ก่อน push |
| **สถานะใหม่ตกร่องเงียบ ๆ** | `attendance.status` ถูก branch แบบ hardcode หลายที่ (`tallyStatuses`, ปพ.5, roll-up, สี) ค่าที่ไม่รู้จักไม่เข้าเงื่อนไขไหนเลย | ดูตาราง "สถานะการเช็คชื่อ — 5 ค่า" ใน `CLAUDE.md` ไล่ให้ครบทุกจุด |

---

## 14. Useful Commands

```bash
# ดู logs server แบบ real-time
npm run dev

# เช็ค database connection
node -e "require('dotenv').config(); require('./lib/db').query('SELECT NOW()').then(r=>console.log(r.rows[0])).catch(console.error).finally(()=>process.exit())"

# List tables ใน Railway DB
node -e "require('dotenv').config(); require('./lib/db').query(\"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\").then(r=>r.rows.forEach(x=>console.log(x.tablename))).finally(()=>process.exit())"

# ดู structure ของ table
node -e "require('dotenv').config(); require('./lib/db').query(\"SELECT column_name,data_type FROM information_schema.columns WHERE table_name='leave_records' ORDER BY ordinal_position\").then(r=>r.rows.forEach(x=>console.log(x.column_name, x.data_type))).finally(()=>process.exit())"

# Generate JWT token สำหรับ test
node -e "require('dotenv').config(); const jwt=require('jsonwebtoken'); console.log(jwt.sign({id:'admin',role:'Admin',name:'Admin'},process.env.JWT_SECRET,{expiresIn:'1d'}))"

# รันเทสทั้งหมด (reseed dev DB ให้เอง)
npm test

# reseed dev DB อย่างเดียว
node db/seed-dev.js

# รันคำสั่งเดียวกับ production (opt-in ต่อคำสั่ง — .env ชี้ localhost เสมอ)
DATABASE_URL=$(node -e "require('dotenv').config({path:'.env.prod'});process.stdout.write(process.env.DATABASE_URL)") node db/backfill-grade-summary.js

# เช็คว่าโค้ดใหม่ขึ้น production แล้วหรือยัง (Railway auto-deploy จาก main)
curl -s https://pw.pssms.app/api/assets/script/Scripts_General | grep -c "<ชื่อฟังก์ชันใหม่>"

# ตรวจหน้าพิมพ์ว่าออกเป็น A4 แนวนอนจริง (A4 landscape = 841.92 x 594.96 pts)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --no-pdf-header-footer \
  --print-to-pdf=/tmp/out.pdf "http://localhost:3000/<หน้าพิมพ์>" && pdfinfo /tmp/out.pdf | grep -i "page size"
```
