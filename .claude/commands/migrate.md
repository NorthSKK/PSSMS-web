Run a PostgreSQL migration against the database `.env` points at.

⚠️ `.env` ชี้ **dev** (`localhost:5432/pssms_dev`) — migration จะลงที่ dev เท่านั้น
ถ้าต้องลง production ให้ระบุ URL ตรง ๆ ต่อคำสั่ง (ดู "Dev DB แยกจาก Production" ใน CLAUDE.md):

```bash
DATABASE_URL=$(node -e "require('dotenv').config({path:'.env.prod'});process.stdout.write(process.env.DATABASE_URL)") node -e "..."
```

**migration ที่เพิ่ม/แก้ column ต้องรันทั้ง 2 ที่** ไม่งั้น dev กับ prod จะ schema ไม่ตรงกัน

Usage: /migrate <SQL statement or description>

Steps:
1. If input is a description (not raw SQL), draft the ALTER TABLE / CREATE TABLE IF NOT EXISTS SQL and show it to the user first
2. Run via node:
   cd "/Users/sik/Documents/[01] Project/Coding/web_PSSMS"
   node -e "require('dotenv').config(); require('./lib/db').query(\`<SQL>\`).then(r=>{console.log('OK',r.rowCount);process.exit()}).catch(e=>{console.error(e.message);process.exit(1)})"
3. Report success/failure
4. Remind to restart server if schema changed
