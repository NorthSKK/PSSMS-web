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

test('migration เติมเลขที่ตามรหัสบนข้อมูลเดิมจริงและเคารพเลขที่ที่กำหนดไว้', async () => {
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE users(username TEXT PRIMARY KEY, role TEXT, department TEXT, year TEXT)`);
    await client.query(`INSERT INTO users VALUES ('2','Student','ม.1/1','2569'),
      ('10','Student','ม.1/1','2569'),('01','Student','ม.1/1','2569')`);
    const sql = require('node:fs').readFileSync(require('node:path').join(__dirname, '../db/migrations/2026-10-26-student-number.sql'), 'utf8');
    await client.query(sql);
    assert.deepEqual((await client.query('SELECT username,student_no FROM users ORDER BY username COLLATE "C"')).rows,
      [{ username: '01', student_no: 1 }, { username: '10', student_no: 2 }, { username: '2', student_no: 3 }]);
    await client.query('UPDATE users SET student_no=NULL');
    await client.query("UPDATE users SET student_no=2 WHERE username='01'");
    await client.query(sql);
    assert.deepEqual((await client.query('SELECT username,student_no FROM users ORDER BY username COLLATE "C"')).rows,
      [{ username: '01', student_no: 2 }, { username: '10', student_no: 1 }, { username: '2', student_no: 3 }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('เลขที่เริ่มต้นถูกบันทึกคงที่ เพิ่มนักเรียนรหัสน้อยกว่าทีหลังไม่ทำให้เลขที่เดิมเลื่อน', async () => {
  await clean();
  await ok('importStudentCSV', [[row(ids[1]), row(ids[2])]], 'admin');
  assert.equal((await read(ids[1])).student_no, 1);
  assert.equal((await read(ids[2])).student_no, 2);
  await ok('addUser', [form(ids[0])], 'admin');
  const roster = await ok('getStudentsByClass', [CLS, YEAR], 'admin');
  assert.deepEqual(roster.map(s => [s[0], s[8]]), [[ids[1], 1], [ids[2], 2], [ids[0], 3]]);
  const users = await ok('getAllUsers', [], 'admin');
  for (const s of roster) assert.equal(users.find(u => u[0] === s[0])[8], s[8]);
});

test('ทะเบียน/ปพ.5 ใช้เลขที่กำหนดและค่าเริ่มต้นตามรหัส โดยรหัสนักเรียนและคะแนนไม่เปลี่ยน', async () => {
  await clean();
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '10' }), row(ids[1], { studentNo: '2' }), row(ids[2])]], 'admin');
  await query(`INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
    VALUES($1,$2,'NUMBER_TEST','formative_0','17',$3,$4)`, ['number-score-test', ids[0], TERM, YEAR]);
  const roster = await ok('getStudentsByClass', [CLS, YEAR], 'admin');
  assert.deepEqual(roster.map(s => s[0]), [ids[2], ids[1], ids[0]]);
  assert.deepEqual(roster.map(s => s[8]), [1, 2, 10]);
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
  assert.equal((await read(ids[0])).student_no, 2, 'ช่องว่างได้เลขที่ว่างถัดไปโดยไม่ชนคนอื่น');
  await ok('importStudentCSV', [[row(ids[1], { room: '92' })]], 'admin');
  assert.equal((await read(ids[1])).student_no, 1, 'ย้ายห้องโดยไม่ระบุเลขที่ได้ค่าเริ่มต้นของห้องใหม่');
  await ok('importStudentCSV', [[row(ids[0], { room: '92', studentNo: '2' }), row(ids[1], { studentNo: '1' })]], 'admin');
  assert.equal((await read(ids[0])).department, 'ม.1/92');
  assert.equal((await read(ids[1])).department, CLS);
});

test('นำเข้าปีใหม่เก็บเลขที่ปีก่อนในประวัติ แม้ไม่ผ่านคำสั่งเลื่อนชั้น', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { year: prior, studentNo: '8' })], 'admin');
  await ok('addUser', [form(ids[1], { year: prior, studentNo: '3' })], 'admin');
  await ok('importStudentCSV', [[row(ids[0])]], 'admin');
  assert.equal((await read(ids[0])).student_no, 1, 'ปีใหม่ได้ค่าเริ่มต้นของปีใหม่ ไม่ใช้เลขที่ปีเก่า');
  await ok('editUser', [form(ids[0], { studentNo: '1' })], 'admin');
  const past = await ok('getStudentsByClass', [CLS, prior], 'admin');
  assert.deepEqual(past.map(s => [s[0], s[8]]), [[ids[1], 3], [ids[0], 8]], 'ต้องรวมทะเบียนเก่าที่ยังไม่เลื่อนกับ snapshot ของคนที่เลื่อนแล้ว');
  const grid = await ok('getAllInOneScoreGridData', ['NUMBER_TEST', CLS, TERM, prior], 'admin');
  assert.deepEqual(grid.students.map(s => [s[0], s[8]]), past.map(s => [s[0], s[8]]));
  await ok('addUser', [form(ids[2], { year: prior, studentNo: '9' })], 'admin');
  await ok('addUser', [form(ids[2], { studentNo: '4' })], 'admin');
  assert.equal((await ok('getStudentsByClass', [CLS, prior], 'admin')).find(s => s[0] === ids[2])[8], 9, 'addUser upsert ต้องเก็บ snapshot เช่นกัน');
});

test('รายชื่อย้อนหลังที่เหลือแต่การเช็คชื่อใช้ลำดับรหัสเดิม ไม่ยืมเลขที่ปัจจุบันมาใส่', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { studentNo: '7' })], 'admin');
  await query(`INSERT INTO attendance(student_id,student_name,class,year,term,subject_code,date,status)
    VALUES($1,'ชื่อเก่า',$2,$3,$4,'NUMBER_TEST','2025-06-02','มา')`, [ids[0], 'ม.2/93', prior, TERM]);
  const past = await ok('getStudentsByClass', ['ม.2/93', prior], 'admin');
  assert.equal(past[0][0], ids[0]);
  assert.equal(past[0][8], 1);
});

test('เลื่อนชั้นเก็บเลขที่เดิมใน snapshot และกำหนดค่าเริ่มต้นของปีใหม่รวมถึงผู้จบการศึกษา', async () => {
  await clean();
  await ok('addUser', [form(ids[0], { year: prior, studentNo: '5' })], 'admin');
  await ok('addUser', [form(ids[1], { year: prior, department: 'ม.3/91', studentNo: '6' })], 'admin');
  await ok('promoteStudentsToNextYear', [], 'admin');
  assert.equal((await read(ids[0])).department, 'ม.2/91');
  assert.equal((await read(ids[0])).student_no, 1);
  assert.equal((await read(ids[1])).student_no, 1);
  assert.equal((await read(ids[1])).status, 'จบการศึกษา');
  const past = await ok('getStudentsByClass', [CLS, prior], 'admin');
  assert.equal(past.find(s => s[0] === ids[0])[8], 5);
});

test('เลขที่ของสมาชิกชุมนุมใช้ห้องเรียน/ปีที่ลงทะเบียนตรงกับทะเบียน', async () => {
  await clean();
  await ok('importStudentCSV', [[row(ids[0], { studentNo: '10' }), row(ids[1], { studentNo: '2' }), row(ids[2])]], 'admin');
  await query(`INSERT INTO clubs(club_id,club_name,capacity,term,year) VALUES('CLUB_number_test','ทดสอบ',10,$1,$2)`, [TERM, YEAR]);
  for (const id of ids.slice(0, 3)) await query(`INSERT INTO club_members(club_id,student_id,class_name,term,year)
    VALUES('CLUB_number_test',$1,$2,$3,$4)`, [id, CLS, TERM, YEAR]);
  const members = await ok('getStudentsByClub', ['CLUB_number_test', YEAR], 'admin');
  assert.deepEqual(members.map(s => [s[0], s[8]]), [[ids[2], 1], [ids[1], 2], [ids[0], 10]]);
});
