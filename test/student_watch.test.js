'use strict';
/**
 * ติดตามนักเรียนรายวัน
 *
 * สิ่งที่ล็อกไว้คือ **การแยกอาการ** ซึ่งพลาดแล้วผู้ปกครองได้ยินเรื่องผิด:
 * "ลูกไม่ไปโรงเรียน" กับ "ลูกไปโรงเรียนแล้วหนีออก" คนละเรื่องกันสิ้นเชิง
 */
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR } = require('./helpers/fixtures');
const { classify } = require('../functions/studentWatch');

const D = '2026-06-11';

const put = (sid, period, status) => query(
  `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,teacher_id,session_id)
   VALUES($1,$2,$3,'ว30205','ฟิสิกส์','ม.6/1',$4,$5,'ทดสอบ',$6,'teacher1','swtest')`,
  [D, TERM, YEAR, period, sid, status]
);
const assembly = (sid, flag) => query(
  `INSERT INTO morning_activity(date,term,year,class,student_id,student_name,flag_status,teacher_id)
   VALUES($1,$2,$3,'ม.6/1',$4,'ทดสอบ',$5,'teacher1')`,
  [D, TERM, YEAR, sid, flag]
);
const watch = () => ok('getDailyStudentWatch', [D], 'admin');
const of = (res, sid) => res.students.find(s => s.studentId === sid);

afterEach(async () => {
  await query(`DELETE FROM attendance WHERE date=$1`, [D]);
  await query(`DELETE FROM morning_activity WHERE date=$1`, [D]);
});
after(stop);

// ------------------------------------------------------------------ สิทธิ์

test('ครูและนักเรียนเปิดไม่ได้ — เป็นข้อมูลพฤติกรรมทั้งโรงเรียน', async () => {
  assert.match(await denied('getDailyStudentWatch', [D], 'teacher1'), /สงวนสิทธิ์/);
  assert.match(await denied('getStudentAttendanceProfile', ['01901', TERM, YEAR], 'student'), /สงวนสิทธิ์/);
});

test('Executive เปิดได้', async () => {
  const res = await ok('getDailyStudentWatch', [D], 'executive');
  assert.equal(res.date, D);
});

// ---------------------------------------------------------------- จำแนก

test('ขาดทุกคาบ + ไม่เข้าแถว = ขาดโรงเรียน', async () => {
  await put('01901', '1', 'ขาด'); await put('01901', '2', 'ขาด');
  assert.deepEqual(of(await watch(), '01901').symptoms, ['away']);
});

test('ขาดทุกคาบ + เข้าแถวแล้ว = มาแล้วหนี ไม่ใช่ขาดโรงเรียน', async () => {
  await put('01901', '1', 'ขาด'); await put('01901', '2', 'ขาด');
  await assembly('01901', 'เข้าแถว');
  const s = of(await watch(), '01901');
  assert.deepEqual(s.symptoms, ['fled'], 'ผู้ปกครองต้องได้ยินว่าลูกมาโรงเรียนแล้ว');
  assert.equal(s.atAssembly, true);
});

test('มาบางคาบ หายบางคาบ = โดด (สรุปเอง ครูไม่ได้กด)', async () => {
  await put('01902', '1', 'มา'); await put('01902', '2', 'ขาด'); await put('01902', '3', 'มา');
  const s = of(await watch(), '01902');
  assert.deepEqual(s.symptoms, ['skip']);
  assert.deepEqual(s.missedPeriods, ['2']);
});

test("ครูกด 'โดด' เองก็ขึ้นเป็นโดด แม้ไม่มีคาบอื่นให้เทียบ", async () => {
  await put('01902', '4', 'โดด');
  assert.ok(of(await watch(), '01902').symptoms.includes('skip'));
});

test('มีได้หลายอาการพร้อมกัน — สายตอนเช้าแล้วโดดคาบบ่าย', async () => {
  await put('01903', '1', 'สาย'); await put('01903', '5', 'ขาด'); await put('01903', '6', 'มา');
  assert.deepEqual(of(await watch(), '01903').symptoms, ['late', 'skip']);
});

test('ลาที่อนุมัติแล้วไม่ใช่อาการ และต้องไม่ทำให้คาบอื่นถูกตีความผิด', async () => {
  // ลาครึ่งวันเช้าแล้วมาบ่าย — ถ้าไม่ตัด 'ลา' ออกจะกลายเป็น "โดดคาบเช้า"
  await put('01904', '1', 'ลา'); await put('01904', '2', 'ลา'); await put('01904', '5', 'มา');
  assert.equal(of(await watch(), '01904'), undefined, 'ต้องไม่ขึ้นในรายการเลย');
});

test('มาครบไม่ขึ้นในรายการ — หน้าโชว์เฉพาะเด็กที่มีอาการ', async () => {
  await put('01901', '1', 'มา'); await put('01901', '2', 'มา');
  const res = await watch();
  assert.equal(of(res, '01901'), undefined);
  assert.ok(res.checkedStudents >= 1, 'แต่ยังนับว่าเช็คชื่อแล้วกี่คน');
});

// -------------------------------------------------------- classify ตรง ๆ

test('classify ไม่ตัดสินอะไรเลยเมื่อไม่มีคาบที่เช็คแล้ว', () => {
  assert.deepEqual(classify([], null), [], 'ไม่มีข้อมูล ≠ เด็กมีปัญหา');
});

// ------------------------------------------------------------- สะสมรายคน

test('ประวัติสะสมบอกว่าหายคาบไหนบ่อย', async () => {
  await put('01901', '3', 'ขาด'); await put('01901', '4', 'มา');
  const p = await ok('getStudentAttendanceProfile', ['01901', TERM, YEAR], 'admin');
  assert.ok(p.totals.skip >= 1);
  assert.ok(p.byPeriod.some(r => r.period === '3'), 'ต้องมีคาบ 3 ในอันดับคาบที่หาย');
  assert.ok(p.days.some(d => d.date === D));
});
