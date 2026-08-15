'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { call, ok, denied, stop } = require('./helpers/api');
const { TERM, YEAR, PHYSICS, HEALTH } = require('./helpers/fixtures');

after(stop);

test('ไม่มี token → Unauthorized', async () => {
  const res = await call('getSubjectConfig', [PHYSICS.code, PHYSICS.className, TERM, YEAR]);
  assert.equal(res.__error, 'Unauthorized');
});

test('token ปลอม → ปฏิเสธ', async () => {
  const res = await call('getSubjectConfig', [PHYSICS.code, PHYSICS.className, TERM, YEAR], 'not.a.jwt');
  assert.match(res.__error, /invalid|expired/i);
});

test('PUBLIC_FNS เรียกได้โดยไม่ต้อง token', async () => {
  const res = await call('getSystemConfig', []);
  assert.equal(res.__error, undefined);
});

test('ครูเขียนคะแนนวิชาที่ตัวเองสอนได้', async () => {
  const res = await ok('saveAllInOneScores', [
    [{ studentId: '01901', indicatorId: 'formative_0', score: '21' }],
    PHYSICS.code, TERM, YEAR,
  ], 'teacher1');
  assert.equal(res.status, 'success');
});

test('ครูคนอื่นเขียนคะแนนวิชาที่ไม่ได้สอนไม่ได้', async () => {
  await denied('saveAllInOneScores', [
    [{ studentId: '01901', indicatorId: 'formative_0', score: '99' }],
    PHYSICS.code, TERM, YEAR,
  ], 'teacher2');
});

test('ADMIN_ONLY ปฏิเสธครู', async () => {
  const msg = await denied('getAllUsers', [], 'teacher1');
  assert.match(msg, /สิทธิ|permission|admin/i);
});

test('Student เรียก TEACHER_OR_ADMIN ไม่ได้', async () => {
  await denied('saveAttendanceBatch', [[{
    date: '2026-05-20', term: TERM, year: YEAR,
    subjectCode: HEALTH.code, subjectName: HEALTH.name, className: HEALTH.className,
    period: '3', studentId: '02001', studentName: 'x', status: 'มา',
  }]], 'student');
});

test('Admin bypass ownership check', async () => {
  const res = await ok('saveAllInOneScores', [
    [{ studentId: '01901', indicatorId: 'formative_0', score: '22' }],
    PHYSICS.code, TERM, YEAR,
  ], 'admin');
  assert.equal(res.status, 'success');
});
