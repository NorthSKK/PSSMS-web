# PSSMS Web — Custom Skills

---

## /dev
**Restart the dev server**

Kill any process on port 3000, then start the server fresh.

Steps:
1. Run: `kill $(lsof -ti :3000) 2>/dev/null; echo "killed"`
2. Run: `cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS" && node server.js &`
3. Wait ~2 seconds, then confirm server is running by checking `lsof -ti :3000`
4. Report: PID + "server ready at http://localhost:3000"

---

## /test-fn
**Test a backend function endpoint**

Usage: `/test-fn <fnName> [arg1] [arg2] ...`

Steps:
1. Read `.env` from the web PSSMS directory to get `JWT_SECRET`
2. Build a Node.js one-liner that:
   - Signs a JWT with `role:'ADMIN', id:'admin'`
   - POSTs to `http://localhost:3000/api/gas/<fnName>` with `args: [arg1, arg2, ...]`
   - Prints the response JSON
3. Run it and show the result
4. If `__error` in response, highlight it

---

## /migrate
**Run a PostgreSQL migration**

Usage: `/migrate <SQL statement or description>`

Steps:
1. If user gave a description (not raw SQL), draft the appropriate `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` SQL first and confirm with user
2. Run via:
   ```bash
   cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
   node -e "
   require('dotenv').config();
   require('./lib/db').query(\`<SQL>\`).then(r => { console.log('OK', r.rowCount); process.exit(); }).catch(e => { console.error(e.message); process.exit(1); });
   "
   ```
3. Report success/failure
4. Remind to restart server if schema changed

---

## /logs
**Tail the server console output**

Run the server in foreground (if not already running) and stream logs.
If server is already running in background, remind user to check the terminal where it was started, or suggest restarting with `/dev` to see output.

---

## /schema
**Show current DB schema for a table**

Usage: `/schema <tableName>`

Run:
```bash
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
require('./lib/db').query(\`
  SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name='\$TABLE'
  ORDER BY ordinal_position
\`).then(r => { console.table(r.rows); process.exit(); });
"
```
Replace `\$TABLE` with the table name. Show result as a table.

---

## /pre-commit
**Pre-commit checklist — ตรวจ wiring bugs ก่อน commit ฟีเจอร์ใหม่**

Steps:
1. อ่าน diff ด้วย `git diff HEAD` (หรือ `git diff --staged` ถ้า staged แล้ว)
2. ระบุว่า diff มี: (a) backend function ใหม่/แก้ไข (b) frontend call ใหม่/แก้ไข (c) ทั้งคู่
3. ตรวจรายการด้านล่าง — ข้ามรายการที่ไม่เกี่ยวกับ diff นั้น

**Backend checks** (ทำต่อทุก function ใหม่/แก้ใน `functions/`)

- [ ] **Signature** — `async function fn([a, b, c])` destructure order ตรงกับ frontend call `google.script.run.fn(a, b, c)` ไหม?
- [ ] **Return format** — write function คืน `{ status:'success', message:'...' }` เสมอ ไม่ใช่ `{ success:true }` หรือ `true`
- [ ] **Error path** — ใช้ `throw new Error(...)` ไม่ใช่ `return { __error: ... }` (dispatcher จัดการให้)
- [ ] **handlers map** — ชื่อฟังก์ชันอยู่ใน handlers object ใน `routes/gas.js` แล้ว?
- [ ] **Permission set** — ฟังก์ชันอยู่ใน `ADMIN_ONLY` หรือ `TEACHER_OR_ADMIN` ใน `routes/gas.js` ตามสิทธิ์ที่ต้องการ?
- [ ] **Teacher ownership** — write function ที่ teacher เรียกได้ → เรียก `verifyTeacherOwnsSubject(user, ...)` ก่อน query?
- [ ] **Cache invalidate** — ถ้า function เขียน timetable → อยู่ใน `TIMETABLE_WRITE_FNS`; เขียน users/students → อยู่ใน `USER_WRITE_FNS`; ถ้าใช้ cache key pattern ใหม่ → เพิ่ม `delPrefix` ใน invalidation block

**Frontend checks** (ทำต่อทุก handler ใหม่/แก้ใน `index.html`)

- [ ] **Success check** — เช็ค `res.status === 'success'` ไม่ใช่ `res.success` หรือ `!!res`
- [ ] **Reload timing** — เรียก reload/refresh data ใน success callback ไม่ใช่ก่อน `.withSuccessHandler`

4. รายงานผล: แต่ละรายการ ✅ pass หรือ ❌ fail พร้อม `file:line` ที่พบปัญหา
5. ถ้ามี ❌ → แก้ก่อน commit แล้วรัน `/pre-commit` ใหม่
