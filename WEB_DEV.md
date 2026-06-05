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
DATABASE_URL=postgresql://user:password@autorack.proxy.rlwy.net:47000/dbname
JWT_SECRET=สตริงสุ่มยาวๆ_อย่างน้อย_32_ตัวอักษร
PORT=3000
```

> **DATABASE_URL** — ดูจาก Railway Dashboard → project → PostgreSQL → Connect  
> **JWT_SECRET** — generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

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
│   ├── leave.js                 updateLeave, deleteLeave, reviewLeave, ...
│   ├── missing.js               Catch-all สำหรับ functions เล็กๆ เยอะ
│   └── ... (ดูรายการครบด้านล่าง)
│
├── public/
│   ├── index.html               SPA shell (compiled จาก GAS HTML)
│   └── gas-shim.js              google.script.run polyfill
│
└── db/
    ├── schema.sql               Full PostgreSQL schema (24 tables)
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
getMyData:   (args) => myDomain.getMyData(args),
saveMyData:  (args) => myDomain.saveMyData(args),
```

### Step 3 — ทดสอบ

```bash
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const token = jwt.sign({id:'admin',role:'Admin'}, process.env.JWT_SECRET, {expiresIn:'1d'});
const http = require('http');
const body = JSON.stringify({ args: ['T001','1','2568'] });
const req = http.request({
  hostname: 'localhost', port: 3000,
  path: '/api/gas/getMyData', method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': 'Bearer ' + token,
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => { console.log(JSON.parse(d)); process.exit(); });
});
req.end(body);
"
```

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

ไม่มี migration framework — ใช้ raw SQL:

```bash
node -e "
require('dotenv').config();
require('./lib/db').query(\`
  ALTER TABLE leave_records ADD COLUMN IF NOT EXISTS request_date TIMESTAMPTZ DEFAULT NOW();
  CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_records(status);
\`).then(() => { console.log('Migration OK'); process.exit(); });
"
```

หลัง migration → restart server

### Reset ข้อมูล (dev เท่านั้น)

```bash
node -e "
require('dotenv').config();
const { query } = require('./lib/db');
query('TRUNCATE TABLE attendance RESTART IDENTITY CASCADE')
  .then(() => { console.log('Cleared'); process.exit(); });
"
```

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

ใน `../src/Scripts_Core.html` ฟังก์ชัน `buildMenu`:
```javascript
{ label: 'หน้าใหม่', icon: 'fa-file', page: 'Page_MyPage', roles: ['Admin'] }
```

---

## 11. Deploy (Railway)

Railway auto-deploy จาก GitHub เมื่อ push ไปที่ branch ที่กำหนด

### Environment Variables ที่ต้องตั้งใน Railway
| Key | หมาย |
|---|---|
| `DATABASE_URL` | Railway จัดให้อัตโนมัติเมื่อ add PostgreSQL service |
| `JWT_SECRET` | random string — ตั้งครั้งแรกแล้วอย่าเปลี่ยน (invalidates all sessions) |
| `PORT` | Railway inject อัตโนมัติ — ไม่ต้องตั้ง |

### Healthcheck
Railway ใช้ HTTP check — server.js ตอบ `200` ทุก GET request (SPA fallback)

### Database Connection
PostgreSQL ใน Railway ต้อง SSL:
```javascript
// lib/db.js — already configured
ssl: { rejectUnauthorized: false }
```

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
```
