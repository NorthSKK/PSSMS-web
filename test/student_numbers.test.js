'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const cache = require('../lib/cache');
const { TERM, YEAR } = require('./helpers/fixtures');

const ids = ['0098101', '0098102', '0098103', '0098104'];
const CLS = 'ม.1/91';
const prior = String(Number(YEAR) - 1);
const form = (id, overrides = {}) => ({
  username: id, password: id, fullname: `นักเรียนเลขที่ ${id}`, role: 'Student',
  department: CLS, year: YEAR, status: 'ปกติ', ...overrides,
});
const row = (id, overrides = {}) => ({
  username: id, fullName: `นักเรียนเลขที่ ${id}`, level: 'ม.1', room: '91', ...overrides,
});
const read = async id => (await query('SELECT * FROM users WHERE username=$1', [id])).rows[0];
async function clean() {
  await query('DELETE FROM club_members WHERE student_id=ANY($1)', [ids]);
  await query('DELETE FROM clubs WHERE club_id=$1', ['CLUB_number_test']);
  await query('DELETE FROM attendance WHERE student_id=ANY($1)', [ids]);
  await query('DELETE FROM score_database WHERE student_id=ANY($1)', [ids]);
  await query('DELETE FROM qualitative_assess WHERE student_id=ANY($1)', [ids]);
  await query('DELETE FROM grade_summary WHERE student_id=ANY($1)', [ids]);
  await query('DELETE FROM users WHERE username=ANY($1)', [ids]);
  await query('DELETE FROM user_history WHERE username=ANY($1)', [ids]);
  cache.delPrefix('students_'); cache.delPrefix('all_users');
}
after(async () => { await clean(); await stop(); });

test('ทะเบียน/ปพ.5 ใช้เลขที่จริง 2 ก่อน 10 และว่างท้าย โดยรหัสนักเรียนและคะแนนไม่เปลี่ยน', async () => {
  await clean();
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '10' }), row(ids[1], { studentNo: '2' }), row(ids[2])]], 'admin');
  await query(`INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
    VALUES($1,$2,'NUMBER_TEST','formative_0','17',$3,$4)`, ['number-score-test', ids[0], TERM, YEAR]);
  const roster = await ok('getStudentsByClass', [CLS, YEAR], 'admin');
  assert.deepEqual(roster.map(s => s[0]), [ids[1], ids[0], ids[2]]);
  assert.deepEqual(roster.map(s => s[8]), [2, 10, null]);
  assert.ok(roster.every(s => s.length === 9));
  const grid = await ok('getAllInOneScoreGridData', ['NUMBER_TEST', CLS, TERM, YEAR], 'admin');
  assert.deepEqual(grid.students, roster);
  assert.equal((await query('SELECT student_id,score FROM score_database WHERE uid=$1', ['number-score-test'])).rows[0].student_id, ids[0]);
  await ok('getAllUsers', [], 'admin'); // เติม cache ก่อนแก้
  await ok('editUser', [form(ids[0], { studentNo: '3' })], 'admin');
  const users = await ok('getAllUsers', [], 'admin');
  assert.equal(users.find(s => s[0] === ids[0])[8], 3);
  assert.equal((await read(ids[0])).username, ids[0]);
});

test('ป้องกันเลขที่ซ้ำ/ไม่ใช่จำนวนเต็มทั้งหน้าทะเบียนและฐานข้อมูล โดยไม่เขียนบางส่วน', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { studentNo: '1' })], 'admin');
  for (const studentNo of ['0', '-1', '1.5', 'abc', '2147483648']) {
    assert.match(await denied('addUser', [form(ids[1], { studentNo })], 'admin'), /จำนวนเต็มบวก/);
  }
  assert.match(await denied('addUser', [form(ids[1], { studentNo: '1', department: 'ม.1 /91' })], 'admin'), /เลขที่.*ซ้ำ/);
  assert.match(await denied('importStudentCSV', [[row(ids[1], { studentNo: '2' }), row(ids[2], { studentNo: '1' })]], 'admin'), /เลขที่.*ซ้ำ/);
  assert.equal(await read(ids[1]), undefined);
  assert.equal((await read(ids[0])).student_no, 1);
  await assert.rejects(query(`INSERT INTO users(username,password,full_name,role,department,year,student_no)
    VALUES($1,'x','x','Student',$2,$3,1)`, [ids[1], CLS, YEAR]), { code: '23505' });
  await ok('addUser', [form(ids[1], { studentNo: '1', department: 'ม.1/92' })], 'admin');
  await ok('addUser', [form(ids[2], { studentNo: '1', year: prior })], 'admin');
});

test('นำเข้าเลขที่สลับกัน/ย้ายห้องเป็นชุดได้ และคงเลขที่เมื่อไฟล์เก่าไม่มีคอลัมน์', async () => {
  await clean();
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '1' }), row(ids[1], { studentNo: '2' })]], 'admin');
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '2' }), row(ids[1], { studentNo: '1' })]], 'admin');
  assert.equal((await read(ids[0])).student_no, 2);
  await ok('importStudentCSV', [[row(ids[0])]], 'admin');
  assert.equal((await read(ids[0])).student_no, 2);
  await ok('editUser', [form(ids[0])], 'admin'); // legacy form ที่ไม่มี studentNo
  assert.equal((await read(ids[0])).student_no, 2);
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '' })]], 'admin');
  assert.equal((await read(ids[0])).student_no, null);
  await ok('importStudentCSV', [[row(ids[1], { room: '92' })]], 'admin');
  assert.equal((await read(ids[1])).student_no, null, 'ย้ายห้องโดยไม่ระบุเลขที่ต้องไม่ใช้เลขที่ห้องเดิม');
  await ok('importStudentCSV', [[row(ids[0], { room: '92', studentNo: '2' }), row(ids[1], { studentNo: '1' })]], 'admin');
  assert.equal((await read(ids[0])).department, 'ม.1/92');
  assert.equal((await read(ids[1])).department, CLS);
});

test('นำเข้าปีใหม่เก็บเลขที่ปีก่อนในประวัติ แม้ไม่ผ่านคำสั่งเลื่อนชั้น', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { year: prior, studentNo: '8' })], 'admin');
  await ok('addUser', [form(ids[1], { year: prior, studentNo: '3' })], 'admin');
  await ok('importStudentCSV', [[row(ids[0])]], 'admin');
  assert.equal((await read(ids[0])).student_no, null);
  await ok('editUser', [form(ids[0], { studentNo: '1' })], 'admin');
  const past = await ok('getStudentsByClass', [CLS, prior], 'admin');
  assert.deepEqual(past.map(s => [s[0], s[8]]), [[ids[1], 3], [ids[0], 8]], 'ต้องรวมทะเบียนเก่าที่ยังไม่เลื่อนกับ snapshot ของคนที่เลื่อนแล้ว');
  const grid = await ok('getAllInOneScoreGridData', ['NUMBER_TEST', CLS, TERM, prior], 'admin');
  assert.deepEqual(grid.students.map(s => [s[0], s[8]]), past.map(s => [s[0], s[8]]));
  await ok('addUser', [form(ids[2], { year: prior, studentNo: '9' })], 'admin');
  await ok('addUser', [form(ids[2], { studentNo: '4' })], 'admin');
  assert.equal((await ok('getStudentsByClass', [CLS, prior], 'admin')).find(s => s[0] === ids[2])[8], 9, 'addUser upsert ต้องเก็บ snapshot เช่นกัน');
});

test('รายชื่อย้อนหลังที่เหลือแต่การเช็คชื่อไม่ยืมเลขที่ปัจจุบันมาใส่', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { studentNo: '7' })], 'admin');
  await query(`INSERT INTO attendance(student_id,student_name,class,year,term,subject_code)
    VALUES($1,'ชื่อเก่า',$2,$3,$4,'NUMBER_TEST')`, [ids[0], 'ม.2/93', prior, TERM]);
  const past = await ok('getStudentsByClass', ['ม.2/93', prior], 'admin');
  assert.equal(past[0][0], ids[0]);
  assert.equal(past[0][8], null);
});

test('เลื่อนชั้นเก็บเลขที่เดิมใน snapshot และล้างเลขที่ของปีใหม่รวมถึงผู้จบการศึกษา', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { year: prior, studentNo: '5' })], 'admin');
  await ok('addUser', [form(ids[1], { year: prior, department: 'ม.3/91', studentNo: '6' })], 'admin');
  await ok('promoteStudentsToNextYear', [], 'admin');
  assert.equal((await read(ids[0])).department, 'ม.2/91');
  assert.equal((await read(ids[0])).student_no, null);
  assert.equal((await read(ids[1])).student_no, null);
  assert.equal((await read(ids[1])).status, 'จบการศึกษา');
  const past = await ok('getStudentsByClass', [CLS, prior], 'admin');
  assert.equal(past.find(s => s[0] === ids[0])[8], 5);
});

test('เลขที่ของสมาชิกชุมนุมใช้ห้องเรียน/ปีที่ลงทะเบียนและว่างท้ายภายในห้อง', async () => {
  await clean();
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '10' }), row(ids[1], { studentNo: '2' }), row(ids[2])]], 'admin');
  await query(`INSERT INTO clubs(club_id,club_name,capacity,term,year) VALUES('CLUB_number_test','ทดสอบ',10,$1,$2)`, [TERM, YEAR]);
  for (const id of ids.slice(0, 3)) await query(`INSERT INTO club_members(club_id,student_id,class_name,term,year)
    VALUES('CLUB_number_test',$1,$2,$3,$4)`, [id, CLS, TERM, YEAR]);
  const members = await ok('getStudentsByClub', ['CLUB_number_test', YEAR], 'admin');
  assert.deepEqual(members.map(s => [s[0], s[8]]), [[ids[1], 2], [ids[0], 10], [ids[2], null]]);
});
