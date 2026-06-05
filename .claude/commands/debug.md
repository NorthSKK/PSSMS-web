Diagnose the PSSMS web server end-to-end. Run every check below in order, collect pass/fail, then print a summary table and fix suggestions.

Project root: /Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS
GAS src dir:  /Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/Wap app PSSMS/src

---

## 1. node_modules
```
ls "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS/node_modules/.bin/node" 2>/dev/null || echo "MISSING"
```
- Missing → `npm install` needed

## 2. .env variables
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
const required = ['DATABASE_URL','JWT_SECRET'];
required.forEach(k => console.log(k+':', process.env[k] ? 'SET ('+String(process.env[k]).length+' chars)' : '*** MISSING ***'));
console.log('PORT:', process.env.PORT || '3000 (default)');
"
```

## 3. GAS src directory
```
ls "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/Wap app PSSMS/src/Index.html" 2>/dev/null && echo "SRC OK" || echo "SRC MISSING — pages will 404"
```

## 4. Server process on port 3000
```
lsof -ti :3000 && echo "RUNNING" || echo "DOWN"
```
- DOWN → suggest `/dev` to start

## 5. HTTP — public endpoint (no auth)
```
curl -s -m 5 http://localhost:3000/api/gas/getSystemConfig \
  -X POST -H "Content-Type: application/json" -d '{"args":[]}' 2>&1 | head -300
```
- Expect `{"__result":{...}}` — connection refused means server is down

## 6. DB connection
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
require('./lib/db').query('SELECT NOW() as ts, current_database() as db, pg_size_pretty(pg_database_size(current_database())) as size')
  .then(r => { console.log('DB OK:', JSON.stringify(r.rows[0])); process.exit(); })
  .catch(e => { console.error('DB FAIL:', e.message); process.exit(1); });
"
```

## 7. Critical tables exist
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
const {query} = require('./lib/db');
const tables = ['users','timetable','attendance','leave_records','calendar_events',
  'clubs','club_members','club_advisors','score_database','subject_config',
  'system_settings','sarabun','morning_activity','grade_summary'];
query(\`SELECT tablename FROM pg_tables WHERE schemaname='public'\`)
  .then(r => {
    const exist = new Set(r.rows.map(x=>x.tablename));
    tables.forEach(t => console.log((exist.has(t)?'✅':'❌'), t));
    process.exit();
  }).catch(e => { console.error(e.message); process.exit(1); });
"
```

## 8. JWT_SECRET round-trip
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
try {
  const tok = jwt.sign({id:'test',role:'ADMIN'}, process.env.JWT_SECRET, {expiresIn:'1m'});
  const dec = jwt.verify(tok, process.env.JWT_SECRET);
  console.log('JWT OK — id:', dec.id, 'role:', dec.role);
} catch(e) { console.error('JWT FAIL:', e.message); }
"
```

## 9. Protected endpoint (with JWT)
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');
const token = jwt.sign({id:'admin',role:'ADMIN'}, process.env.JWT_SECRET, {expiresIn:'1m'});
const body = JSON.stringify({args:[]});
const req = http.request({
  hostname:'localhost',port:3000,
  path:'/api/gas/getAllUsers',method:'POST',
  headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+token}
}, res => {
  let d=''; res.on('data',c=>d+=c);
  res.on('end',()=>{
    const r = JSON.parse(d);
    if(r.__error) console.error('FAIL:', r.__error);
    else console.log('OK — users count:', Array.isArray(r.__result)?r.__result.length:'(non-array)');
  });
});
req.on('error', e => console.error('CONNECTION ERROR:', e.message));
req.end(body);
"
```

## 10. Admin login end-to-end
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
const http = require('http');
const body = JSON.stringify({args:['admin','1234']});
const req = http.request({
  hostname:'localhost',port:3000,path:'/api/gas/checkLogin',method:'POST',
  headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
}, res => {
  let d=''; res.on('data',c=>d+=c);
  res.on('end',()=>{
    const r=JSON.parse(d);
    if(r.__result?.status==='success') console.log('LOGIN OK — role:', r.__result.role, '| JWT:', r.__jwt?'issued':'MISSING');
    else console.error('LOGIN FAIL:', r.__error || r.__result?.message);
  });
});
req.on('error', e => console.error('CONNECTION ERROR:', e.message));
req.end(body);
"
```

## 11. Static assets reachable
```
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ && echo " (index.html)"
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/gas-shim.js && echo " (gas-shim.js)"
```
- Expect 200 for both

## 12. GAS page load test
```
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "
require('dotenv').config();
const http = require('http');
const body = JSON.stringify({args:['Page_Teacher']});
const req = http.request({
  hostname:'localhost',port:3000,path:'/api/gas/getPage',method:'POST',
  headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
}, res => {
  let d=''; res.on('data',c=>d+=c);
  res.on('end',()=>{
    const r=JSON.parse(d);
    if(r.__error) console.error('PAGE FAIL:', r.__error);
    else console.log('PAGE OK — length:', String(r.__result||'').length, 'chars');
  });
});
req.on('error', e => console.error('CONNECTION ERROR:', e.message));
req.end(body);
"
```
- Short result or error → SRC_DIR ผิด หรือไฟล์หาย

---

## Summary
After all checks, print a table:

| # | Check | Status | Note |
|---|-------|--------|------|
| 1 | node_modules | ✅/❌ | |
| 2 | .env vars | ✅/❌ | |
| 3 | GAS src dir | ✅/❌ | |
| 4 | Server port 3000 | ✅/❌ | |
| 5 | HTTP public endpoint | ✅/❌ | |
| 6 | DB connection | ✅/❌ | |
| 7 | Critical tables | ✅/❌ | list missing |
| 8 | JWT round-trip | ✅/❌ | |
| 9 | Protected endpoint | ✅/❌ | |
| 10 | Admin login | ✅/❌ | |
| 11 | Static assets | ✅/❌ | |
| 12 | GAS page load | ✅/❌ | |

Then for each ❌ give a specific fix command or action.
