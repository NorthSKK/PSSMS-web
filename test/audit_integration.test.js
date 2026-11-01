'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');

// Dedicated fixtures: never modify active school settings or shared seed rows.
const YEAR = '2578', TERM = '2', SUB = 'ว99991', CLASS = 'ม.1/99', STUDENT = '0099791';
const CLUB = 'CLUB_AUDIT_CURRENT', OLD_CLUB = 'CLUB_AUDIT_PRIOR';
async function clean() {
  await query('DELETE FROM club_members WHERE student_id=$1', [STUDENT]);
  await query('DELETE FROM clubs WHERE club_id=ANY($1)', [[CLUB, OLD_CLUB]]);
  for (const table of ['attendance', 'grade_summary', 'qualitative_assess', 'score_database', 'subject_config', 'score_history', 'timetable']) {
    await query(`DELETE FROM ${table} WHERE subject_code=$1`, [SUB]);
  }
  await query('DELETE FROM users WHERE username=$1', [STUDENT]);
}
before(async () => {
  await clean();
  await query(`INSERT INTO users(username,password,full_name,role,department,year,status)
    VALUES($1,'test','นักเรียนทดสอบแก้บั๊ก','Student',$2,$3,'ปกติ')`, [STUDENT, CLASS, YEAR]);
  await query(`INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
    VALUES($1,'วิชาทดสอบแก้บั๊ก','ม.1','99','teacher1','จันทร์','1',$2,$3)`, [SUB, TERM, YEAR]);
});
after(async () => { await clean(); await stop(); });
const save = extra => ok('saveAllInOneWithConfig', [{ subjectCode: SUB, className: CLASS,
  term: TERM, year: YEAR, ...extra }], 'teacher1');
const config = async () => (await query('SELECT score_ratio FROM subject_config WHERE subject_code=$1 AND term=$2 AND year=$3', [SUB, TERM, YEAR])).rows[0];
const competency = async () => (await query('SELECT comp FROM qualitative_assess WHERE student_id=$1 AND subject_code=$2 AND term=$3 AND year=$4', [STUDENT, SUB, TERM, YEAR])).rows[0]?.comp;

test('HTTP score save persists 100:0:0 and competency zero; legacy omission preserves existing competency', async () => {
  await save({ newConfig: { formative: 100, midterm: 0, final: 0, indicators: [] }, qualRecords: [{ studentId: STUDENT, comp: 0 }] });
  assert.equal((await config()).score_ratio, '100:0:0');
  assert.equal(Number(await competency()), 0);
  const grid = await ok('getAllInOneScoreGridData', [SUB, CLASS, TERM, YEAR], 'teacher1');
  assert.equal(grid.existingQuals['99791'].comp, 0, 'loading the grid must preserve saved competency zero');
  await save({ qualRecords: [{ studentId: STUDENT, comp: 2 }] });
  await save({ qualRecords: [{ studentId: STUDENT, char1: '1' }] });
  assert.equal(Number(await competency()), 2);
});

test('cross-context assessment is rejected before configuration or scores change in PostgreSQL', async () => {
  await save({ newConfig: { formative: 100, midterm: 0, final: 0, indicators: [] } });
  for (const override of [{ subjectCode: 'OTHER_AUDIT' }, { term: '1' }, { year: '2577' }]) {
    const message = await denied('saveAllInOneWithConfig', [{ subjectCode: SUB, className: CLASS, term: TERM, year: YEAR,
      newConfig: { formative: 70, midterm: 10, final: 20 },
      scoreRecords: [{ studentId: STUDENT, indicatorId: 'audit_denied', score: '99' }],
      qualRecords: [{ studentId: STUDENT, comp: 3, ...override }],
    }], 'teacher1');
    assert.match(message, /วิชา.*ภาคเรียน.*ปีการศึกษา/);
    assert.equal((await config()).score_ratio, '100:0:0');
  }
  assert.equal((await query(`SELECT count(*)::int AS n FROM score_database WHERE subject_code=$1 AND indicator_id='audit_denied'`, [SUB])).rows[0].n, 0);
});

test('single and batch attendance-history edits actually create and withdraw automatic MS', async () => {
  const sessions = [];
  for (let day = 1; day <= 5; day++) {
    const date = `2035-06-${String(day).padStart(2, '0')}`, session = `${date}|${SUB}|${CLASS}|1`;
    const result = await query(`INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
      VALUES($1,$2,$3,$4,'วิชาทดสอบแก้บั๊ก',$5,'1',$6,'นักเรียนทดสอบ','ขาด',$7,'teacher1') RETURNING id`, [date, TERM, YEAR, SUB, CLASS, STUDENT, session]);
    sessions.push({ session, id: result.rows[0].id });
  }
  const readGrade = async () => (await query('SELECT grade,ms_source,attendance_percent FROM grade_summary WHERE student_id=$1 AND subject_code=$2 AND term=$3 AND year=$4', [STUDENT, SUB, TERM, YEAR])).rows[0];
  // One weekly timetable period means 20 total course periods: 5 absences = 75%.
  await ok('updateAttendanceStatus', [sessions[4].session, STUDENT, 'ขาด'], 'teacher1');
  assert.equal((await readGrade()).ms_source, 'auto');
  assert.equal(Number((await readGrade()).attendance_percent), 75);
  await ok('updateAttendanceStatus', [sessions[4].session, STUDENT, 'มา'], 'teacher1');
  assert.equal(await readGrade(), undefined, 'returning to exactly 80% withdraws the automatic MS');
  const changed = await ok('updateAttendanceBatch', [[{ rowIdx: sessions[4].id, status: 'ขาด' }]], 'teacher1');
  assert.equal(changed.updated, 1);
  assert.equal((await readGrade()).grade, 'มส');
  await ok('updateAttendanceBatch', [[{ rowIdx: sessions[3].id, status: 'มา' }, { rowIdx: sessions[4].id, status: 'มา' }]], 'teacher1');
  assert.equal(await readGrade(), undefined);
});

test('admin adds a student with prior-year club history, but suspended/graduated students cannot be added', async () => {
  for (const [id, year] of [[CLUB, YEAR], [OLD_CLUB, '2577']]) {
    await query(`INSERT INTO clubs(club_id,club_name,capacity,term,year,status) VALUES($1,'ชุมนุมทดสอบแก้บั๊ก',10,$2,$3,'open')`, [id, TERM, year]);
  }
  await query(`INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year) VALUES($1,$2,'นักเรียนทดสอบ',$3,$4,'2577')`, [OLD_CLUB, STUDENT, CLASS, TERM]);
  await ok('adminAddMember', [CLUB, STUDENT], 'admin');
  const memberships = (await query('SELECT club_id,student_id FROM club_members WHERE student_id=$1 ORDER BY year', [STUDENT])).rows;
  assert.deepEqual(memberships, [{ club_id: OLD_CLUB, student_id: STUDENT }, { club_id: CLUB, student_id: STUDENT }]);
  await query('DELETE FROM club_members WHERE club_id=$1', [CLUB]);
  for (const status of ['แขวนลอย', 'จบการศึกษา']) {
    await query('UPDATE users SET status=$1 WHERE username=$2', [status, STUDENT]);
    assert.match(await denied('adminAddMember', [CLUB, STUDENT], 'admin'), /ไม่สามารถเพิ่มสมาชิก/);
  }
  assert.equal((await query('SELECT count(*)::int AS n FROM club_members WHERE club_id=$1', [CLUB])).rows[0].n, 0);
  assert.equal((await query('SELECT count(*)::int AS n FROM club_members WHERE club_id=$1', [OLD_CLUB])).rows[0].n, 1);
});
