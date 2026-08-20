'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { TERM, YEAR, PHYSICS, M6_STUDENTS } = require('./helpers/fixtures');

after(stop);

// db/seed-dev.js ผูกคาบสอนแทนกับสัปดาห์ปัจจุบัน: day 0 = วันนี้,
// teacher2 สอนแทน teacher1 วิชา ว30205 ม.6/1 คาบ 2 และ 6
const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const SUB_PERIOD = '2';

test('ตารางวันนี้ของครูสอนแทน มีคาบสอนแทนรวมอยู่ด้วย', async () => {
  const rows = await ok('getTeacherTimetableWithStatus', ['teacher2'], 'teacher2');
  const sub = rows.find(r => r[8]);
  assert.ok(sub, 'คาบสอนแทนไม่ขึ้นในตารางวันนี้');
  assert.equal(sub[0], PHYSICS.code);
  assert.equal(sub[2], PHYSICS.className);
  assert.equal(sub[9], 'ครูสมชาย ใจดี');
  assert.equal(sub.date, TODAY);
});

test('ตารางวันนี้ของครูที่ไม่ได้สอนแทน ไม่มีคาบสอนแทนปน', async () => {
  const rows = await ok('getTeacherTimetableWithStatus', ['teacher3'], 'admin');
  assert.equal(rows.filter(r => r[8]).length, 0);
});

test('getTeacherDashboardBundle ส่ง substitutes 7 วันข้างหน้า', async () => {
  const bundle = await ok('getTeacherDashboardBundle', ['teacher2', TERM, YEAR], 'teacher2');
  assert.equal(bundle.substitutes.ok, true);
  assert.ok(bundle.substitutes.data.length > 0);
  assert.equal(bundle.substitutes.data[0].originalTeacherName, 'ครูสมชาย ใจดี');
});

const batch = (date, period) => M6_STUDENTS.map(id => ({
  date, term: TERM, year: YEAR,
  subjectCode: PHYSICS.code, subjectName: PHYSICS.name, className: PHYSICS.className,
  period, studentId: id, studentName: `นักเรียน ${id}`, status: 'มา',
}));

test('ครูสอนแทนเช็คชื่อคาบที่ถูกจัดให้ได้', async () => {
  const res = await ok('saveAttendanceBatch', [batch(TODAY, SUB_PERIOD)], 'teacher2');
  assert.equal(res.status, 'success');
});

test('ครูสอนแทนเช็คชื่อวิชาเดียวกันคนละคาบไม่ได้', async () => {
  await denied('saveAttendanceBatch', [batch(TODAY, '7')], 'teacher2');
});

test('ครูสอนแทนเช็คชื่อวิชาเดียวกันคนละวันไม่ได้', async () => {
  await denied('saveAttendanceBatch', [batch('2026-05-20', SUB_PERIOD)], 'teacher2');
});

test('สอนแทน 1 คาบ ไม่ได้สิทธิ์กรอกคะแนนทั้งวิชา', async () => {
  await denied('saveAllInOneScores', [
    [{ studentId: M6_STUDENTS[0], indicatorId: 'formative_0', score: '99' }],
    PHYSICS.code, TERM, YEAR,
  ], 'teacher2');
});
