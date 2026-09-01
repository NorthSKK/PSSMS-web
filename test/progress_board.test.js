'use strict';
/**
 * กระดานติดตามงานครู
 *
 * ล็อกสี่อย่างที่พลาดแล้วตัวเลขบนกระดานผิดโดยไม่มี error:
 *   1) ใครเปิดได้ — Executive ต้องเปิดได้ (ผอ.) ครูต้องไม่ได้
 *   2) โฮมรูมเก็บผลที่ morning_activity ไม่ใช่ attendance — นับผิดตาราง
 *      = ครูที่ปรึกษาทุกคนค้าง 100% ตลอดกาลทั้งที่ทำงานครบ
 *   3) `-` และ CLUB_* ต้องไม่อยู่ในตัวหาร — ไม่มีที่เก็บผล/ไม่ใช่เวลาเรียนรายวิชา
 *   4) ครูสอนแทนเช็คชื่อแล้ว เจ้าของคาบต้องได้เครดิต ไม่ใช่ค้าง
 */
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const cache = require('../lib/cache');
const { slotsFromRows, expandSlots } = require('../lib/sessionCalendar');
const { _holidayDates } = require('../functions/attendance');
const { TERM, YEAR } = require('./helpers/fixtures');

const KEY = `progress_board_${TERM}_${YEAR}`;
const board = () => { cache.del(KEY); return ok('getTeacherProgressBoard', [], 'admin'); };
const subjectOf = (t, code) => t.subjects.find(s => s.subjectCode === code);
const att = (b, id, code) => subjectOf(teacherOf(b, id), code).attendance;
const teacherOf = (b, id) => b.teachers.find(t => t.teacherId === id);

// วันแรกที่ตารางบอกว่าควรมีคาบนี้ — ใช้สูตรร่วมตัวเดียวกับที่กระดานใช้
async function firstExpectedDate(subjectCode, teacherId, opts = {}) {
  const tt = await query(
    `SELECT day, period FROM timetable WHERE subject_code=$1 AND teacher_id=$2 AND term=$3 AND year=$4`,
    [subjectCode, teacherId, TERM, YEAR]
  );
  const td = await query(
    `SELECT value1, value2 FROM system_settings WHERE key='TermData' AND subkey=$1`, [`${TERM}_${YEAR}`]
  );
  const start = new Date(`${String(td.rows[0].value1).slice(0, 10)}T00:00:00Z`);
  const termEnd = td.rows[0].value2 ? new Date(`${String(td.rows[0].value2).slice(0, 10)}T00:00:00Z`) : null;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const end = termEnd && termEnd < today ? termEnd : today;
  const days = expandSlots(slotsFromRows(tt.rows), start, end, await _holidayDates(start, end));
  if (!opts.unchecked) return days[0];
  // seed เช็คชื่อบางคาบไว้แล้ว — คาบที่จะใช้ทดสอบต้องเป็นคาบที่ยังไม่เคยเช็ค
  const done = await query(
    `SELECT DISTINCT to_char(date,'YYYY-MM-DD') AS d, period FROM attendance
     WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [subjectCode, TERM, YEAR]
  );
  const taken = new Set(done.rows.map(r => `${r.d}|${r.period}`));
  return days.find(d => !taken.has(`${d.date}|${d.period}`));
}

afterEach(async () => {
  await query(`DELETE FROM morning_activity WHERE student_id LIKE 'ptest%'`);
  await query(`DELETE FROM attendance WHERE student_id LIKE 'ptest%'`);
  await query(`DELETE FROM timetable WHERE subject_code IN ('-','CLUB_PTEST')`);
  cache.del(KEY);
});
after(stop);

// ------------------------------------------------------------------ สิทธิ์

test('ครูและนักเรียนเปิดกระดานไม่ได้', async () => {
  assert.match(await denied('getTeacherProgressBoard', [], 'teacher1'), /สงวนสิทธิ์/);
  assert.match(await denied('getTeacherProgressBoard', [], 'student'), /สงวนสิทธิ์/);
});

test('Admin และ Executive เปิดได้ — ผอ. เห็นทั้งโรงเรียน (ADR 0001)', async () => {
  const asAdmin = await ok('getTeacherProgressBoard', [], 'admin');
  cache.del(KEY);
  const asExec = await ok('getTeacherProgressBoard', [], 'executive');
  assert.ok(asExec.teachers.length > 0);
  assert.deepEqual(
    asExec.teachers.map(t => t.teacherId).sort(),
    asAdmin.teachers.map(t => t.teacherId).sort(),
    'Executive ต้องเห็นครูชุดเดียวกับ Admin ไม่ถูกกรองตาม dept'
  );
});

// ---------------------------------------------------------------- ตัวหาร

test('แถวมาจากภาระสอนจริง ไม่ใช่จาก role', async () => {
  const b = await board();
  const ids = b.teachers.map(t => t.teacherId);
  assert.ok(ids.includes('teacher1'), 'ครูที่มีคาบต้องขึ้น');
  assert.ok(!ids.includes('admin'), 'คนที่ไม่มีคาบไม่ต้องขึ้นเป็นแถว 0/0');
  assert.ok(b.teachers.every(t => t.name), 'ทุกแถวต้องมีชื่อแสดง');
});

test('`-` และ CLUB_* ไม่เข้าตัวหาร', async () => {
  const before = teacherOf(await board(), 'teacher1').attendance.expected;
  for (const code of ['-', 'CLUB_PTEST']) {
    await query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
       VALUES($1,$1,'ม.6','1','teacher1','จันทร์','7',$2,$3)`,
      [code, TERM, YEAR]
    );
  }
  const t = teacherOf(await board(), 'teacher1');
  assert.equal(t.attendance.expected, before, 'ตัวหารต้องไม่ขยับ');
  assert.equal(t.subjects.filter(s => s.subjectCode === '-' || s.subjectCode.startsWith('CLUB')).length, 0);
});

// ---------------------------------------------------------------- โฮมรูม

test('โฮมรูมนับตัวเศษจาก morning_activity ไม่ใช่ attendance', async () => {
  const slot = await firstExpectedDate('HR', 'teacher2');
  assert.ok(slot, 'seed ต้องมีคาบ HR ของ teacher2 ในเทอมปัจจุบัน');

  const hrBefore = att(await board(), 'teacher2', 'HR');
  assert.ok(hrBefore.expected > 0);
  assert.equal(hrBefore.done, 0);

  // เขียนลง attendance ก่อน — ต้องไม่ถูกนับ เพราะโฮมรูมไม่ได้เก็บที่นี่
  await query(
    `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,teacher_id,session_id)
     VALUES($1,$2,$3,'HR','โฮมรูม','ม.2/1','0','ptest1','ทดสอบ','มา','teacher2','ptest')`,
    [slot.date, TERM, YEAR]
  );
  assert.equal(att(await board(), 'teacher2', 'HR').done, 0,
    'แถวใน attendance ต้องไม่ทำให้โฮมรูมนับว่าเช็คแล้ว');

  await query(
    `INSERT INTO morning_activity(date,term,year,class,student_id,student_name,flag_status,teacher_id)
     VALUES($1,$2,$3,'ม.2/1','ptest1','ทดสอบ','เข้าแถว','teacher2')`,
    [slot.date, TERM, YEAR]
  );
  assert.equal(att(await board(), 'teacher2', 'HR').done, 1);
});

test('โฮมรูมนับที่ "มีแถว" ไม่ได้บังคับให้กรอกครบทั้ง 3 ช่อง', async () => {
  const slot = await firstExpectedDate('HR', 'teacher2');
  await query(
    `INSERT INTO morning_activity(date,term,year,class,student_id,student_name,teacher_id)
     VALUES($1,$2,$3,'ม.2/1','ptest2','ทดสอบ','teacher2')`,
    [slot.date, TERM, YEAR]
  );
  assert.equal(att(await board(), 'teacher2', 'HR').done, 1,
    'area/duty/flag ว่างทั้งหมดก็ยังนับว่าเปิดมาทำแล้ว');
});

test('โฮมรูมไม่เข้าตัวหารของคอลัมน์ตั้งค่าวิชาและคะแนน', async () => {
  const hr = subjectOf(teacherOf(await board(), 'teacher2'), 'HR');
  assert.equal(hr.config.expected, 0);
  assert.equal(hr.scores.expected, 0);
});

// ------------------------------------------------------------- ครูสอนแทน

test('ครูสอนแทนเช็คชื่อแล้ว เจ้าของคาบได้เครดิต', async () => {
  const slot = await firstExpectedDate('ว30205', 'teacher1', { unchecked: true });
  assert.ok(slot, 'ต้องมีคาบที่ยังไม่เคยเช็คเหลืออยู่');
  const before = att(await board(), 'teacher1', 'ว30205').done;
  await query(
    `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,teacher_id,session_id)
     VALUES($1,$2,$3,'ว30205','ฟิสิกส์','ม.6/1',$4,'ptest3','ทดสอบ','มา','teacher4','ptest')`,
    [slot.date, TERM, YEAR, slot.period]
  );
  assert.equal(att(await board(), 'teacher1', 'ว30205').done, before + 1,
    'คาบถูกเช็คแล้วจริง ต่อให้คนเช็คคือครูสอนแทน');
});

// -------------------------------------------------------------- licence

test('เปิดกระดานได้แม้ licence หมดอายุ — เป็นฟังก์ชันอ่าน', async () => {
  const license = require('../lib/license');
  await query(
    `INSERT INTO system_settings(key, subkey, value1) VALUES('license','until','2020-01-01')
     ON CONFLICT(key, subkey) DO UPDATE SET value1='2020-01-01'`
  );
  license.invalidate();
  try {
    const b = await ok('getTeacherProgressBoard', [], 'admin');
    assert.ok(b.teachers.length > 0);
  } finally {
    await query(`DELETE FROM system_settings WHERE key='license' AND subkey='until'`);
    license.invalidate();
  }
});
