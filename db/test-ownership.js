/**
 * Manual ownership-check smoke tests.
 * Run: node db/test-ownership.js
 * Requires server running on :3000.
 */
'use strict';
require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const HOST = 'localhost';
const PORT = 3000;

function makeToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '1d' });
}

const adminToken   = makeToken({ id: 'admin', role: 'ADMIN' });
const teacherToken = makeToken({ id: 'teacher_test', role: 'TEACHER' });
const otherToken   = makeToken({ id: 'other_teacher', role: 'TEACHER' });

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: HOST, port: PORT, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function run() {
  let pass = 0, fail = 0;

  async function check(label, fn, expect) {
    try {
      const res = await fn();
      const ok = expect(res);
      if (ok) { console.log(`  PASS  ${label}`); pass++; }
      else     { console.log(`  FAIL  ${label}`, JSON.stringify(res)); fail++; }
    } catch (e) {
      console.log(`  ERR   ${label}`, e.message);
      fail++;
    }
  }

  console.log('\n=== saveAllInOneScores: other teacher cannot write foreign subject ===');
  await check(
    'other_teacher blocked from subject not on their timetable',
    () => post('/api/gas/saveAllInOneScores',
      { args: [[{ studentId: 'S001', indicatorId: 'formative_0', score: '10' }], 'SUBJ_FAKE', '1', '2568'] },
      otherToken),
    r => r.__error && r.__error.includes('สิทธิ์')
  );

  console.log('\n=== updateAttendanceStatus: cannot update foreign session ===');
  await check(
    'other_teacher blocked from session they do not own',
    () => post('/api/gas/updateAttendanceStatus',
      { args: ['nonexistent_session_id', 'S001', 'ขาด'] },
      otherToken),
    r => r.__error && r.__error.includes('สิทธิ์')
  );

  console.log('\n=== deleteDetailedLessonRecord: cannot delete foreign record ===');
  await check(
    'other_teacher blocked from record id 999999 (nonexistent or not theirs)',
    () => post('/api/gas/deleteDetailedLessonRecord',
      { args: ['999999'] },
      otherToken),
    r => r.__error && r.__error.includes('สิทธิ์')
  );

  console.log('\n=== updateDetailedLessonRecord: cannot update foreign record ===');
  await check(
    'other_teacher blocked from record id 999999',
    () => post('/api/gas/updateDetailedLessonRecord',
      { args: ['999999', { date: '2568-01-01', subjectCode: 'TEST', subjectName: 'Test', className: 'ม.1/1', period: '1', topic: 'x' }] },
      otherToken),
    r => r.__error && r.__error.includes('สิทธิ์')
  );

  console.log('\n=== getAllInOneScoreGridData: blocked for non-teacher of subject ===');
  await check(
    'other_teacher blocked from score grid for subject not on timetable',
    () => post('/api/gas/getAllInOneScoreGridData',
      { args: ['SUBJ_FAKE', 'ม.1/1', '1', '2568'] },
      otherToken),
    r => r.__error && r.__error.includes('สิทธิ์')
  );

  console.log('\n=== saveTodoList: returns status:success ===');
  await check(
    'saveTodoList returns {status:"success"}',
    () => post('/api/gas/saveTodoList', { args: ['admin', '[]'] }, adminToken),
    r => r.__result && r.__result.status === 'success'
  );

  console.log(`\nResults: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
