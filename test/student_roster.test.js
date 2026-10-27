'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { studentNo, compareStudents, studentArray, assignStudentNumbers } = require('../lib/studentRoster');
const { prepareRows, importSpec } = require('../lib/importSpec');

test('เลขที่เป็นจำนวนเต็มบวกหรือว่าง แยกจากรหัสนักเรียนที่มีศูนย์นำหน้า', () => {
  for (const blank of [undefined, null, '', ' ']) assert.equal(studentNo(blank), null);
  assert.equal(studentNo('02'), 2);
  assert.equal(studentNo(10), 10);
  for (const value of [0, -1, 1.5, '2x', '1e2', 'Infinity', 2147483648]) {
    assert.throws(() => studentNo(value), /จำนวนเต็มบวก/);
  }
  assert.equal(studentArray({ username: '01903', student_no: 2 })[0], '01903');
  assert.equal(studentArray({ username: '01903', student_no: 2 })[8], 2);
});

test('ทะเบียนเรียงเลขที่แบบตัวเลขและเลขที่ว่างอยู่ท้าย ใช้รหัสดิบตัดสินเมื่อเลขที่ว่างเหมือนกัน', () => {
  const rows = [
    { username: '01901', department: 'ม.1/1', student_no: null },
    { username: '01902', department: 'ม.1/1', student_no: 10 },
    { username: '01903', department: 'ม.1/1', student_no: 2 },
    { username: '01904', department: 'ม.1/1', student_no: null },
  ];
  assert.deepEqual(rows.sort(compareStudents).map(r => r.username), ['01903', '01902', '01901', '01904']);
});

test('ค่าเริ่มต้นใช้ลำดับรหัสแบบเดิมและไม่แย่งเลขที่ที่กำหนดแล้ว', () => {
  const rows = [
    { username: '2', department: 'ม.1/1', year: '2569', student_no: null },
    { username: '10', department: 'ม.1/1', year: '2569', student_no: null },
    { username: '01', department: 'ม.1/1', year: '2569', student_no: 2 },
  ];
  assignStudentNumbers(rows);
  assert.deepEqual(rows.map(r => r.student_no), [3, 1, 2]);
  const newcomer = { username: '00', department: 'ม.1/1', year: '2569', student_no: null };
  assignStudentNumbers([...rows, newcomer]);
  assert.equal(newcomer.student_no, 4);
  assert.deepEqual(rows.map(r => r.student_no), [3, 1, 2], 'เพิ่มคนรหัสน้อยกว่าไม่ทำให้เลขที่เดิมเลื่อน');
});

test('ไฟล์นักเรียนไม่ส่งคอลัมน์เลขที่ต้องไม่ถูกแปลงเป็นช่องว่างที่ล้างข้อมูล', () => {
  const base = { username: '01903', fullName: 'ทดสอบ', level: 'ม.1', room: '1' };
  const absent = prepareRows('student', [base]);
  const blank = prepareRows('student', [{ ...base, studentNo: '' }]);
  assert.equal(Object.hasOwn(absent.rows[0], 'studentNo'), false);
  assert.equal(Object.hasOwn(blank.rows[0], 'studentNo'), true);
  assert.equal(blank.rows[0].studentNo, '');
  const col = importSpec().specs.student.columns.find(c => c.key === 'studentNo');
  assert.equal(col.required, undefined);
  assert.equal(col.label, 'เลขที่');
});

test('เลขที่ซ้ำในห้องเดียวกันในไฟล์ถูกปฏิเสธ แต่ต่างห้องหรือเลขที่ว่างซ้ำได้', () => {
  const row = { fullName: 'ทดสอบ', level: 'ม.1', room: '1', studentNo: '2' };
  assert.equal(prepareRows('student', [{ ...row, username: '01903' }, { ...row, username: '01904' }]).errors.length, 1);
  assert.equal(prepareRows('student', [{ ...row, username: '01903', studentNo: '02' }, { ...row, username: '01904' }]).errors.length, 1);
  assert.equal(prepareRows('student', [{ ...row, username: '01903', studentNo: '2147483648' }]).errors.length, 1);
  assert.equal(prepareRows('student', [{ ...row, username: '01903' }, { ...row, username: '01904', room: '2' }]).errors.length, 0);
  assert.equal(prepareRows('student', [{ ...row, username: '01903', studentNo: '' }, { ...row, username: '01904', studentNo: '' }]).errors.length, 0);
});
