#!/usr/bin/env node
'use strict';

/**
 * Load test ที่รันกับฐานข้อมูลพัฒนาเท่านั้น
 *
 * จำลองช่วงเช้าที่หนักที่สุดของโรงเรียน: ครูเปิดสมุดเช็คชื่อ แล้วบันทึก
 * พร้อมกันทั้งโรงเรียน ข้อมูล PERF_* ถูกสร้างชั่วคราวและลบใน finally เสมอ.
 *
 * Usage:
 *   node scripts/load-test.js
 *   node scripts/load-test.js --profile=large
 */
process.env.NODE_ENV = 'test';
const fs = require('fs');
const remoteRequested = process.argv.includes('--remote');
// lib/db reads this during require. Values still undergo the staging marker check below
// before any test data is written.
if (remoteRequested) {
  if (process.env.PSSMS_LOAD_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.PSSMS_LOAD_TEST_DATABASE_URL;
  if (process.env.PSSMS_LOAD_TEST_JWT_SECRET) process.env.JWT_SECRET = process.env.PSSMS_LOAD_TEST_JWT_SECRET;
  if (process.env.PSSMS_LOAD_TEST_DATABASE_SSL) process.env.DATABASE_SSL = process.env.PSSMS_LOAD_TEST_DATABASE_SSL;
}
require('dotenv').config();

const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');
const { pool, query } = require('../lib/db');

const PREFIX = 'PERF_';
const TERM = 'PERF';
const YEAR = '9999';
const DATE = '2026-09-07'; // Monday; within the synthetic term below
const PROFILES = {
  small:  { teachers: 20,  studentsPerClass: 25 }, // โรงเรียนเล็ก
  medium: { teachers: 50,  studentsPerClass: 30 }, // โรงเรียนกลาง
  large:  { teachers: 100, studentsPerClass: 35 }, // โรงเรียนใหญ่
};
const REMOTE = remoteRequested;
const outputArg = process.argv.find(a => a.startsWith('--output='));

async function assertTestTarget() {
  if (REMOTE) {
    const baseUrl = String(process.env.PSSMS_LOAD_TEST_URL || '').replace(/\/$/, '');
    const remoteDb = String(process.env.PSSMS_LOAD_TEST_DATABASE_URL || '');
    if (process.env.PSSMS_LOAD_TEST_CONFIRM !== 'STAGING_ONLY') {
      throw new Error('remote mode ต้องตั้ง PSSMS_LOAD_TEST_CONFIRM=STAGING_ONLY');
    }
    if (!/^https:\/\//.test(baseUrl) || !remoteDb || !process.env.PSSMS_LOAD_TEST_JWT_SECRET) {
      throw new Error('remote mode ต้องมี URL แบบ https, database URL และ JWT secret ของ staging ครบ');
    }
    const marker = await query(
      `SELECT 1 FROM system_settings
       WHERE key='Instance' AND subkey='Environment' AND LOWER(COALESCE(value1,''))='staging'`
    );
    if (!marker.rows.length) {
      throw new Error('ปลายทางไม่มี marker Instance/Environment=staging — ปฏิเสธเพื่อกันยิงโรงเรียนจริง');
    }
    return;
  }
  let host = '';
  try { host = new URL(String(process.env.DATABASE_URL || '')).hostname; } catch (_) { /* handled below */ }
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`ปฏิเสธการทดสอบ: DATABASE_URL ต้องเป็น localhost (ตอนนี้: ${host || 'อ่านไม่ได้'})`);
  }
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET ไม่มีใน .env');
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function summarise(name, results, peakWaiting) {
  const times = results.filter(r => r.ok).map(r => r.ms);
  const failures = results.filter(r => !r.ok);
  return {
    scenario: name,
    requests: results.length,
    succeeded: times.length,
    failed: failures.length,
    latencyMs: times.length ? {
      min: Math.min(...times),
      mean: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      p50: percentile(times, 0.50),
      p95: percentile(times, 0.95),
      p99: percentile(times, 0.99),
      max: Math.max(...times),
    } : null,
    sampleErrors: failures.slice(0, 3).map(r => r.error),
    peakDbWaiting: peakWaiting,
  };
}

async function startServer() {
  if (REMOTE) return { server: null, baseUrl: String(process.env.PSSMS_LOAD_TEST_URL).replace(/\/$/, '') };
  const app = require('../server');
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function stopServer(server) {
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
}

function request(baseUrl, fnName, args, token) {
  const body = JSON.stringify({ args });
  const started = performance.now();
  const transport = baseUrl.startsWith('https://') ? https : http;
  return new Promise(resolve => {
    const req = transport.request(`${baseUrl}/api/gas/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
      },
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        const ms = Math.round(performance.now() - started);
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed.__error ? { ok: false, ms, error: parsed.__error } : { ok: true, ms });
        } catch {
          resolve({ ok: false, ms, error: `HTTP ${res.statusCode}: ${raw.slice(0, 160)}` });
        }
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('timeout after 30 seconds')));
    req.on('error', err => resolve({ ok: false, ms: Math.round(performance.now() - started), error: err.message }));
    req.end(body);
  });
}

async function cleanup() {
  // Prefix นี้สร้างโดย script นี้เท่านั้น. ลบ rows dependent ก่อน user เพื่อไม่ทิ้งข้อมูลทดสอบ.
  await query(`DELETE FROM attendance WHERE teacher_id LIKE $1 OR student_id LIKE $1`, [`${PREFIX}%`]);
  await query(`DELETE FROM timetable WHERE teacher_id LIKE $1`, [`${PREFIX}%`]);
  await query(`DELETE FROM users WHERE username LIKE $1`, [`${PREFIX}%`]);
  await query(`DELETE FROM system_settings WHERE key='TermData' AND subkey=$1`, [`${TERM}_${YEAR}`]);
}

async function createSchool({ teachers, studentsPerClass }) {
  const existing = await query(`SELECT username FROM users WHERE username LIKE $1 LIMIT 1`, [`${PREFIX}%`]);
  if (existing.rows.length) throw new Error('พบข้อมูล PERF_ ค้างอยู่ จึงหยุดเพื่อไม่ลบข้อมูลที่ไม่ได้สร้างในรอบนี้');

  const identities = [];
  const users = { username: [], password: [], fullName: [], role: [], department: [], email: [], year: [], status: [] };
  const timetable = { code: [], name: [], level: [], room: [], location: [], teacherId: [], day: [], period: [], term: [], year: [] };
  for (let i = 1; i <= teachers; i++) {
    const n = String(i).padStart(3, '0');
    const teacherId = `${PREFIX}T${n}`;
    const level = `${PREFIX}L${n}`;
    const className = `${level}/1`;
    const subjectCode = `${PREFIX}S${n}`;
    users.username.push(teacherId); users.password.push('load-test'); users.fullName.push(`ครูทดสอบ ${n}`);
    users.role.push('Teacher'); users.department.push('ทดสอบ'); users.email.push(`${teacherId.toLowerCase()}@dev.local`);
    users.year.push(YEAR); users.status.push('ปกติ');
    timetable.code.push(subjectCode); timetable.name.push('วิชาทดสอบ'); timetable.level.push(level);
    timetable.room.push('1'); timetable.location.push('ห้องทดสอบ'); timetable.teacherId.push(teacherId);
    timetable.day.push('จันทร์'); timetable.period.push('1'); timetable.term.push(TERM); timetable.year.push(YEAR);

    const students = [];
    for (let j = 1; j <= studentsPerClass; j++) {
      const studentId = `${PREFIX}ST${n}${String(j).padStart(3, '0')}`;
      const studentName = `นักเรียนทดสอบ ${n}/${j}`;
      users.username.push(studentId); users.password.push('load-test'); users.fullName.push(studentName);
      users.role.push('Student'); users.department.push(className); users.email.push(`${studentId.toLowerCase()}@dev.local`);
      users.year.push(YEAR); users.status.push('ปกติ');
      students.push({ studentId, studentName });
    }
    identities.push({ teacherId, className, subjectCode, students });
  }
  // Setup is a single transaction: a cancelled runner loses the uncommitted fixture
  // rather than leaving a partial PERF_ school behind for the next run.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('TermData',$1,'2026-05-11','2026-10-10')`,
      [`${TERM}_${YEAR}`]
    );
    await client.query(
      `INSERT INTO users(username,password,full_name,role,department,email,year,status)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[],
                            $5::text[], $6::text[], $7::text[], $8::text[])`,
      [users.username, users.password, users.fullName, users.role, users.department, users.email, users.year, users.status]
    );
    await client.query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[],
                            $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])`,
      [timetable.code, timetable.name, timetable.level, timetable.room, timetable.location,
       timetable.teacherId, timetable.day, timetable.period, timetable.term, timetable.year]
    );
    await client.query('COMMIT');
    return identities;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function runScenario(baseUrl, name, jobs) {
  let peakWaiting = 0;
  const sampler = setInterval(() => { peakWaiting = Math.max(peakWaiting, pool.waitingCount); }, 5);
  try {
    const results = await Promise.all(jobs);
    return summarise(name, results, peakWaiting);
  } finally {
    clearInterval(sampler);
  }
}

async function runProfile(baseUrl, name, config) {
  const identities = await createSchool(config);
  const tokens = new Map(identities.map(i => [i.teacherId, jwt.sign({ id: i.teacherId, role: 'Teacher' }, process.env.JWT_SECRET, { expiresIn: '5m' })]));
  try {
    // ทำให้ cache และ JIT ผ่านรอบแรกก่อนวัด burst จริง
    await request(baseUrl, 'getMassiveAttendanceGrid', [null, identities[0].subjectCode, identities[0].className, TERM, YEAR], tokens.get(identities[0].teacherId));

    const writes = identities.map(i => request(baseUrl, 'saveAttendanceBatch', [i.students.map(s => ({
      date: DATE, term: TERM, year: YEAR, subjectCode: i.subjectCode, subjectName: 'วิชาทดสอบ',
      className: i.className, period: '1', studentId: s.studentId, studentName: s.studentName, status: 'มา',
    }))], tokens.get(i.teacherId)));

    const writesResult = await runScenario(baseUrl, 'เช็คชื่อพร้อมกัน', writes);
    const gridsResult = await runScenario(baseUrl, 'เปิดสมุดเช็คชื่อพร้อมกัน', identities.map(i =>
      request(baseUrl, 'getMassiveAttendanceGrid', [null, i.subjectCode, i.className, TERM, YEAR], tokens.get(i.teacherId))
    ));
    const dashboardsResult = await runScenario(baseUrl, 'เปิดแดชบอร์ดครูพร้อมกัน', identities.map(i =>
      request(baseUrl, 'getTeacherDashboardBundle', [i.teacherId, TERM, YEAR], tokens.get(i.teacherId))
    ));
    return { profile: name, teachers: config.teachers, students: config.teachers * config.studentsPerClass, scenarios: [writesResult, gridsResult, dashboardsResult] };
  } finally {
    await cleanup();
  }
}

async function main() {
  await assertTestTarget();
  const choice = process.argv.find(a => a.startsWith('--profile='));
  const selected = choice ? { [choice.slice(10)]: PROFILES[choice.slice(10)] } : PROFILES;
  if (Object.values(selected).some(v => !v)) throw new Error(`profile ไม่ถูกต้อง: ${choice}`);

  const { server, baseUrl } = await startServer();
  const started = Date.now();
  try {
    const reports = [];
    for (const [name, config] of Object.entries(selected)) reports.push(await runProfile(baseUrl, name, config));
    const report = {
      generatedAt: new Date().toISOString(),
      environment: REMOTE ? 'staging' : 'local development database',
      dbPoolMax: 20,
      elapsedMs: Date.now() - started,
      reports,
    };
    if (outputArg) fs.writeFileSync(outputArg.slice('--output='.length), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    // createSchool() อาจล้มก่อนเข้า finally ของ runProfile; เก็บกวาด prefix ของเรา
    // ก่อนปิด pool ไม่เช่นนั้น cleanup ใน catch ภายนอกจะต่อ DB ไม่ได้แล้ว.
    await cleanup();
    throw err;
  } finally {
    await stopServer(server);
    await pool.end();
  }
}

main().catch(async err => {
  console.error(`load test failed: ${err.message}`);
  process.exitCode = 1;
});
