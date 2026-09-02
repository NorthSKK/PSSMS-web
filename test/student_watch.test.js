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
const cache = require('../lib/cache');
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

// ------------------------------------------------------- อันดับสะสม

const RD = ['2026-08-24', '2026-08-25', '2026-08-26'];   // ภายใน 30 วันจากวันทดสอบ
const putOn = (sid, date, period, status) => query(
  `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,teacher_id,session_id)
   VALUES($1,$2,$3,'ว30205','ฟิสิกส์','ม.6/1',$4,$5,'ชื่อเก่าในแถวเช็คชื่อ',$6,'teacher1',$7)`,
  [date, TERM, YEAR, period, sid, status, 'rk' + date + period + sid]
);
const rank = (days) => {
  cache.del(`student_rank_${TERM}_${YEAR}_${days}`);
  return ok('getStudentWatchRanking', [days], 'admin');
};
const inList = (res, k, sid) => res.lists[k].find(r => r.studentId === sid);

afterEach(async () => {
  await query(`DELETE FROM attendance WHERE session_id LIKE 'rk%'`);
  await query(`DELETE FROM morning_activity WHERE date = ANY($1)`, [RD]);
  for (const d of [0, 7, 30]) cache.del(`student_rank_${TERM}_${YEAR}_${d}`);
});

test('ต้องมีอาการอย่างน้อย 2 วันถึงจะติดอันดับ', async () => {
  await putOn('01901', RD[0], '1', 'มา'); await putOn('01901', RD[0], '2', 'ขาด');
  assert.equal(inList(await rank(30), 'skip', '01901'), undefined, '1 วันยังไม่เป็นรูปแบบ');

  await putOn('01901', RD[1], '1', 'มา'); await putOn('01901', RD[1], '2', 'ขาด');
  const r = inList(await rank(30), 'skip', '01901');
  assert.ok(r, '2 วันแล้วต้องติด');
  assert.equal(r.count, 2);
  assert.equal(r.lastDate, RD[1], 'ครั้งล่าสุดต้องเป็นวันหลังสุด');
});

test('แต่ละอาการเป็นคนละอันดับ ไม่รวมเป็นคะแนนเดียว', async () => {
  for (const d of RD) {
    await putOn('01901', d, '1', 'สาย'); await putOn('01901', d, '2', 'มา');   // สายล้วน
    await putOn('01902', d, '1', 'ขาด'); await putOn('01902', d, '2', 'ขาด');  // ขาดโรงเรียน
  }
  const r = await rank(30);
  assert.ok(inList(r, 'late', '01901'), '01901 ต้องอยู่ลิสต์สาย');
  assert.equal(inList(r, 'away', '01901'), undefined, 'และต้องไม่อยู่ลิสต์ขาดโรงเรียน');
  assert.ok(inList(r, 'away', '01902'));
  assert.equal(inList(r, 'late', '01902'), undefined);
});

test('เรียงด้วยเลขดิบ ไม่ใช่อัตราส่วน — และมีตัวหารติดมาด้วย', async () => {
  // 01901: โดด 3 วันจาก 3 (100%) · 01902: โดด 2 วันจาก 3 (67%)
  for (const d of RD) {
    await putOn('01901', d, '1', 'มา'); await putOn('01901', d, '2', 'ขาด');
    await putOn('01902', d, '1', 'มา');
    await putOn('01902', d, '2', d === RD[2] ? 'มา' : 'ขาด');
  }
  const list = (await rank(30)).lists.skip;
  assert.equal(list[0].studentId, '01901', 'คนที่มีจำนวนวันมากกว่าต้องมาก่อน');
  assert.equal(list[0].count, 3);
  assert.ok(list[0].daysWithData >= 3, 'ตัวหารต้องส่งมาให้คนอ่านตีความ');
  // docs/adr/0002 — ห้ามมี % เวลาเรียนโผล่มาในผลลัพธ์
  assert.equal(list[0].percent, undefined);
});

test('ช่วง 7 วันต้องเป็นสับเซตของ 30 วัน', async () => {
  for (const d of RD) { await putOn('01903', d, '1', 'มา'); await putOn('01903', d, '2', 'ขาด'); }
  const w30 = inList(await rank(30), 'skip', '01903');
  const w7  = inList(await rank(7),  'skip', '01903');
  assert.ok(w30, 'ต้องติดอันดับในช่วง 30 วัน');
  assert.ok(!w7 || w7.count <= w30.count, 'ช่วงสั้นกว่าต้องนับได้ไม่เกินช่วงยาว');
});

test('ชื่อมาจาก users สด ไม่ใช่ชื่อที่ค้างอยู่ในแถวเช็คชื่อ', async () => {
  for (const d of RD) { await putOn('01901', d, '1', 'มา'); await putOn('01901', d, '2', 'ขาด'); }
  const r = inList(await rank(30), 'skip', '01901');
  assert.notEqual(r.name, 'ชื่อเก่าในแถวเช็คชื่อ');
  const { rows } = await query(`SELECT full_name FROM users WHERE username='01901'`);
  assert.equal(r.name, rows[0].full_name);
});

test('ช่วงที่ไม่รู้จักตกกลับไปที่ 30 วัน', async () => {
  cache.del(`student_rank_${TERM}_${YEAR}_30`);
  const r = await ok('getStudentWatchRanking', [999], 'admin');
  assert.equal(r.days, 30);
});

test('ครูเปิดอันดับไม่ได้', async () => {
  assert.match(await denied('getStudentWatchRanking', [30], 'teacher1'), /สงวนสิทธิ์/);
});
