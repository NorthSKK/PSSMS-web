'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR, PHYSICS, M6_STUDENTS } = require('./helpers/fixtures');

after(stop);

const DATE = '2026-05-20';
const PERIOD = '2';
const SESSION = `${DATE}|${PHYSICS.code}|${PHYSICS.className}|${PERIOD}`;

const batch = (statusOf) => M6_STUDENTS.map(id => ({
  date: DATE, term: TERM, year: YEAR,
  subjectCode: PHYSICS.code, subjectName: PHYSICS.name, className: PHYSICS.className,
  period: PERIOD, studentId: id, studentName: `นักเรียน ${id}`, status: statusOf(id),
}));

test('saveAttendanceBatch เขียนครบทุกคน + teacher_id มาจาก JWT', async () => {
  const res = await ok('saveAttendanceBatch', [batch(id => id === '01903' ? 'ขาด' : 'มา')], 'teacher1');
  assert.equal(res.status, 'success');
  assert.equal(res.saved, M6_STUDENTS.length);

  const { rows } = await query(
    `SELECT student_id, status, teacher_id FROM attendance WHERE session_id=$1 ORDER BY student_id`,
    [SESSION]
  );
  assert.equal(rows.length, M6_STUDENTS.length);
  // id ดิบต้องคงอยู่ — normID/parseInt เคยตัด 0 นำหน้าจนบันทึกไม่ลง
  assert.deepEqual(rows.map(r => r.student_id), M6_STUDENTS);
  assert.equal(rows.find(r => r.student_id === '01903').status, 'ขาด');
  assert.ok(rows.every(r => r.teacher_id === 'teacher1'));
});

test('บันทึกซ้ำ session เดิม = ทับ ไม่ใช่เพิ่มแถว', async () => {
  await ok('saveAttendanceBatch', [batch(() => 'มา')], 'teacher1');
  await ok('saveAttendanceBatch', [batch(() => 'ลา')], 'teacher1');
  const { rows } = await query(`SELECT status FROM attendance WHERE session_id=$1`, [SESSION]);
  assert.equal(rows.length, M6_STUDENTS.length);
  assert.ok(rows.every(r => r.status === 'ลา'));
});

test('ครูคนอื่นเช็คชื่อวิชาที่ไม่ได้สอนไม่ได้', async () => {
  await denied('saveAttendanceBatch', [batch(() => 'ขาด')], 'teacher2');
});

test('getSemesterReport หารด้วยคาบตามตารางสอน ไม่ใช่จำนวนแถว attendance', async () => {
  await ok('saveAttendanceBatch', [batch(id => id === '01903' ? 'ขาด' : 'มา')], 'teacher1');
  const rep = await ok('getSemesterReport', [PHYSICS.code, PHYSICS.className, TERM, YEAR], 'teacher1');
  const list = Array.isArray(rep) ? rep : (rep.students || rep.data || []);
  assert.ok(list.length > 0, 'report ต้องมีนักเรียน');

  // seed: 3 คาบ/สัปดาห์ × 20 สัปดาห์ = 60 คาบ, 01903 ขาด 3 ครั้ง (seed 2 + เทสนี้ 1)
  const row = list.find(r => String(r.studentId ?? r.id ?? r.student_id) === '01903');
  assert.ok(row, 'ต้องเจอ 01903 ด้วย id ดิบ');
  const pct = Number(row.percent ?? row.percentage);
  assert.ok(pct > 90 && pct < 100, `percent ควรราว 95 (60 คาบ ขาด 3) ได้ ${pct}`);
});
