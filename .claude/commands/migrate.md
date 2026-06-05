Run a PostgreSQL migration against the Railway DB.

Usage: /migrate <SQL statement or description>

Steps:
1. If input is a description (not raw SQL), draft the ALTER TABLE / CREATE TABLE IF NOT EXISTS SQL and show it to the user first
2. Run via node:
   cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
   node -e "require('dotenv').config(); require('./lib/db').query(\`<SQL>\`).then(r=>{console.log('OK',r.rowCount);process.exit()}).catch(e=>{console.error(e.message);process.exit(1)})"
3. Report success/failure
4. Remind to restart server if schema changed
