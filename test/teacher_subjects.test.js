'use strict';
/**
 * รายวิชาสำหรับหน้าวิชาการ/ปพ.5
 *
 * Client รุ่นเดิมส่ง userId และ role มาด้วยเพื่อให้ GAS ใช้ได้ แต่ Web ต้องไม่เชื่อ
 * ข้อมูลนั้น: JWT เป็นแหล่งเดียวของตัวตนและสิทธิ์.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, stop } = require('./helpers/api');
const { TERM, YEAR, PHYSICS, HEALTH } = require('./helpers/fixtures');

after(stop);

const subjectKeys = (subjects) => subjects.map(([code, , classId]) => `${code}|${classId}`).sort();
const args = (id, role) => [id, role, TERM, YEAR];

test('Executive ที่ไม่มีตารางสอนเห็นรายวิชาทั้งโรงเรียนเท่ากับ Admin', async () => {
  const adminSubjects = await ok('getTeacherSubjects', args('admin', 'Admin'), 'admin');
  const executiveSubjects = await ok('getTeacherSubjects', args('director', 'Executive'), 'executive');

  assert.deepEqual(subjectKeys(executiveSubjects), subjectKeys(adminSubjects));
  assert.ok(subjectKeys(executiveSubjects).includes(`${PHYSICS.code}|${PHYSICS.className}`));
  assert.ok(subjectKeys(executiveSubjects).includes(`${HEALTH.code}|${HEALTH.className}`));
});

test('ครูปลอม role หรือ userId ใน payload แล้วเห็นรายวิชาคนอื่นไม่ได้', async () => {
  const ownSubjects = await ok('getTeacherSubjects', args('teacher1', 'Teacher'), 'teacher1');
  const spoofedAdmin = await ok('getTeacherSubjects', args('admin', 'Admin'), 'teacher1');
  const spoofedTeacher = await ok('getTeacherSubjects', args('teacher2', 'Teacher'), 'teacher1');

  assert.deepEqual(subjectKeys(spoofedAdmin), subjectKeys(ownSubjects));
  assert.deepEqual(subjectKeys(spoofedTeacher), subjectKeys(ownSubjects));
  assert.ok(subjectKeys(ownSubjects).includes(`${PHYSICS.code}|${PHYSICS.className}`));
  assert.ok(!subjectKeys(ownSubjects).includes(`${HEALTH.code}|${HEALTH.className}`));
});
