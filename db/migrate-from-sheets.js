/**
 * migrate-from-sheets.js
 * One-time migration: Google Sheets → PostgreSQL
 * Run: node db/migrate-from-sheets.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const { Pool } = require('pg');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Sheets API ──────────────────────────────────────────────
let _auth;
async function getAuth() {
  if (_auth) return _auth;
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '..', process.env.GOOGLE_KEY_FILE || 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  _auth = await auth.getClient();
  return _auth;
}
async function readSheet(name) {
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: name });
    const rows = res.data.values || [];
    return rows.length > 1 ? rows.slice(1) : [];
  } catch { return []; }
}

// ── Helpers ─────────────────────────────────────────────────
const str     = v => (v == null || v === '') ? null : String(v).trim();
const safeJson = v => { if (!v) return null; try { return JSON.parse(v); } catch { return null; } };
const num  = v => (v == null || v === '') ? null : Number(String(v).replace(/,/g,'')) || null;
const date = v => {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null') return null;
  // Handle Thai date formats or ISO
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

function log(msg) { process.stdout.write(msg + '\n'); }
function ok(table, n) { log(`  ✓ ${table}: ${n} rows`); }

// ── Migration tasks ──────────────────────────────────────────
async function migrateSystemSettings() {
  const rows = await readSheet('System_Settings');
  for (const r of rows) {
    const key = str(r[0]); const val = str(r[1]);
    if (!key) continue;
    if (key === 'Active' && val === 'Term') {
      await pool.query(
        `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('Active','Term',$1,$2)
         ON CONFLICT(key,subkey) DO UPDATE SET value1=$1,value2=$2`,
        [str(r[2]), str(r[3])]
      );
    } else if (key === 'TermData') {
      await pool.query(
        `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('TermData',$1,$2,$3)
         ON CONFLICT(key,subkey) DO UPDATE SET value1=$2,value2=$3`,
        [val ?? '', str(r[2]), str(r[3])]
      );
    } else {
      await pool.query(
        `INSERT INTO system_settings(key,subkey,value1) VALUES($1,'',$2)
         ON CONFLICT(key,subkey) DO UPDATE SET value1=$2`,
        [key, val]
      );
    }
  }
  ok('system_settings', rows.length);
}

async function migrateUsers() {
  const rows = await readSheet('User_Database');
  let n = 0;
  for (const r of rows) {
    if (!str(r[0])) continue;
    await pool.query(
      `INSERT INTO users(username,password,full_name,role,department,email,year,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(username) DO UPDATE SET
         password=$2,full_name=$3,role=$4,department=$5,email=$6,year=$7,status=$8`,
      [str(r[0]),str(r[1]),str(r[2])??'',str(r[3])??'Teacher',str(r[4]),str(r[5]),str(r[6]),str(r[7])||'ปกติ']
    );
    n++;
  }
  ok('users', n);
}

async function migrateTimetable() {
  await pool.query('DELETE FROM timetable');
  const rows = await readSheet('Timetable_Database');
  let n = 0;
  for (const r of rows) {
    if (!str(r[0]) || !str(r[5])) continue;
    await pool.query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [str(r[0]),str(r[1])??'',str(r[2])??'',str(r[3])??'',str(r[4]),str(r[5]),str(r[6]),str(r[7]),str(r[8]),str(r[9])]
    );
    n++;
  }
  ok('timetable', n);
}

async function migrateAttendance() {
  await pool.query('DELETE FROM attendance');
  const rows = await readSheet('Attendance_Database');
  const chunk = 500;
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const vals = [], params = [];
    let p = 1;
    for (const r of batch) {
      if (!date(r[1]) || !str(r[8])) continue;
      vals.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11})`);
      params.push(date(r[1]),str(r[2]),str(r[3]),str(r[4]),str(r[5]),str(r[6]),str(r[7]),str(r[8]),str(r[9]),str(r[10]),str(r[11]),str(r[12]));
      p += 12; n++;
    }
    if (vals.length) await pool.query(
      `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,teacher_id,session_id)
       VALUES ${vals.join(',')}`, params
    );
  }
  ok('attendance', n);
}

async function migrateAcademicRecords() {
  await pool.query('DELETE FROM academic_records');
  const rows = await readSheet('Academic_Records');
  let n = 0;
  for (const r of rows) {
    if (!date(r[1])) continue;
    await pool.query(
      `INSERT INTO academic_records(date,term,year,subject_code,subject_name,class,period,topic,present,absent,leave,teacher_id,signature,session_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [date(r[1]),str(r[2]),str(r[3]),str(r[4]),str(r[5]),str(r[6]),str(r[7]),str(r[8]),num(r[9]),num(r[10]),num(r[11]),str(r[12]),str(r[13]),str(r[14])]
    );
    n++;
  }
  ok('academic_records', n);
}

async function migrateBudgets() {
  const rows = await readSheet('Budgets');
  let n = 0;
  for (const r of rows) {
    if (!str(r[0])) continue;
    await pool.query(
      `INSERT INTO budgets(project_id,project_name,budget_amount,used_amount,status,year)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(project_id) DO UPDATE SET project_name=$2,budget_amount=$3,used_amount=$4,status=$5,year=$6`,
      [str(r[0]),str(r[1])??'',num(r[2])??0,num(r[3])??0,str(r[5])||'active',str(r[6])]
    );
    n++;
  }
  ok('budgets', n);
}

async function migrateLeaveRecords() {
  const rows = await readSheet('Leave_Records');
  let n = 0;
  for (const r of rows) {
    if (!str(r[1]) || !date(r[4])) continue;
    await pool.query(
      `INSERT INTO leave_records(id,teacher_id,staff_name,type,start_date,end_date,days,reason,status,year,admin_comment,reviewed_by)
       VALUES(COALESCE($1,gen_random_uuid()::TEXT),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT(id) DO NOTHING`,
      [str(r[0]),str(r[1]),str(r[2]),str(r[3])||'',date(r[4]),date(r[5])??date(r[4]),num(r[6])??1,str(r[7]),str(r[8])||'รอพิจารณา',str(r[9]),str(r[11]),str(r[12])]
    );
    n++;
  }
  ok('leave_records', n);
}

async function migrateCalendar() {
  await pool.query('DELETE FROM calendar_events');
  const rows = await readSheet('Calendar_Database');
  let n = 0;
  for (const r of rows) {
    if (!str(r[1]) || !date(r[2])) continue;
    await pool.query(
      `INSERT INTO calendar_events(id,title,start_date,end_date,color,description,created_by)
       VALUES(COALESCE($1,gen_random_uuid()::TEXT),$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO NOTHING`,
      [str(r[0]),str(r[1]),date(r[2]),date(r[3]),str(r[4])||'#3b82f6',str(r[5]),str(r[6])]
    );
    n++;
  }
  ok('calendar_events', n);
}

async function migrateSarabun() {
  await pool.query('DELETE FROM sarabun');
  const rows = await readSheet('Sarabun_Database');
  let n = 0;
  for (const r of rows) {
    if (!str(r[2]) && !str(r[1])) continue;
    await pool.query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [str(r[1]),str(r[2]),str(r[3]),str(r[4]),date(r[5]),str(r[6])||'รอดำเนินการ',str(r[7]),str(r[8])]
    );
    n++;
  }
  ok('sarabun', n);
}

async function migrateClubs() {
  const rows = await readSheet('Club_Database');
  let n = 0;
  for (const r of rows) {
    if (!str(r[0])) continue;
    await pool.query(
      `INSERT INTO clubs(club_id,club_name,description,capacity,term,year,status)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(club_id) DO UPDATE SET club_name=$2,description=$3,capacity=$4,status=$7`,
      [str(r[0]),str(r[1])??'',str(r[2]),num(r[3])??0,str(r[4]),str(r[5]),str(r[6])||'open']
    );
    n++;
  }
  const advRows = await readSheet('Club_Advisors');
  for (const r of advRows) {
    if (!str(r[0]) || !str(r[1])) continue;
    await pool.query(
      `INSERT INTO club_advisors(club_id,teacher_id,teacher_name,role,term,year)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [str(r[0]),str(r[1]),str(r[2]),str(r[3])||'หัวหน้า',str(r[4]),str(r[5])]
    );
  }
  const memRows = await readSheet('Club_Members');
  for (const r of memRows) {
    if (!str(r[0]) || !str(r[1])) continue;
    await pool.query(
      `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [str(r[0]),str(r[1]),str(r[2]),str(r[3]),str(r[4]),str(r[5]),str(r[6])]
    );
  }
  ok('clubs + advisors + members', n);
}

async function migrateCurriculum() {
  await pool.query('DELETE FROM curriculum');
  const rows = await readSheet('Curriculum_Database');
  let n = 0;
  for (const r of rows) {
    if (!str(r[0])) continue;
    await pool.query(
      `INSERT INTO curriculum(subject_code,subject_type,standard_code,description,eval_type)
       VALUES($1,$2,$3,$4,$5)`,
      [str(r[0]),str(r[1]),str(r[2]),str(r[3]),str(r[4])]
    );
    n++;
  }
  ok('curriculum', n);
}

async function migrateScores() {
  const configRows = await readSheet('Subject_Config');
  for (const r of configRows) {
    if (!str(r[1]) || !str(r[2])) continue;
    await pool.query(
      `INSERT INTO subject_config(subject_id,subject_code,class_name,term,year,score_ratio,indicators_json,teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(subject_code,class_name,term,year) DO UPDATE SET score_ratio=$6,indicators_json=$7,teacher_id=$8`,
      [str(r[0]),str(r[1]),str(r[2]),str(r[3]),str(r[4]),str(r[5]),safeJson(str(r[6])),str(r[7])]
    );
  }
  const scoreRows = await readSheet('Score_Database');
  for (const r of scoreRows) {
    if (!str(r[1]) || !str(r[2])) continue;
    await pool.query(
      `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(student_id,subject_code,indicator_id,term,year) DO UPDATE SET score=$5`,
      [str(r[0]),str(r[1]),str(r[2]),str(r[3]),num(r[4]),str(r[5]),str(r[6])]
    );
  }
  const gradeRows = await readSheet('Grade_Summary');
  for (const r of gradeRows) {
    if (!str(r[0]) || !str(r[1])) continue;
    await pool.query(
      `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,remedial_status,attendance_percent,term,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(student_id,subject_code,term,year) DO UPDATE SET total_score=$3,grade=$4`,
      [str(r[0]),str(r[1]),num(r[2]),str(r[3]),str(r[4]),num(r[5]),str(r[6]),str(r[7])]
    );
  }
  ok('subject_config + scores + grades', scoreRows.length);
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  log('\n🚀 PSSMS Migration: Sheets → PostgreSQL\n');
  const client = await pool.connect();
  try {
    // Apply schema
    const fs = require('fs');
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    log('✓ Schema applied\n');
  } finally { client.release(); }

  const tasks = [
    ['System Settings', migrateSystemSettings],
    ['Users',           migrateUsers],
    ['Timetable',       migrateTimetable],
    ['Attendance',      migrateAttendance],
    ['Academic Records',migrateAcademicRecords],
    ['Budgets',         migrateBudgets],
    ['Leave Records',   migrateLeaveRecords],
    ['Calendar',        migrateCalendar],
    ['Sarabun',         migrateSarabun],
    ['Clubs',           migrateClubs],
    ['Curriculum',      migrateCurriculum],
    ['Scores/ปพ.5',     migrateScores],
  ];

  for (const [name, fn] of tasks) {
    process.stdout.write(`Migrating ${name}... `);
    try { await fn(); }
    catch (e) { log(`\n  ✗ ERROR: ${e.message}`); }
  }

  await pool.end();
  log('\n✅ Migration complete!\n');
}

main().catch(e => { console.error(e); process.exit(1); });
