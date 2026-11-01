'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, call, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const Y = '2580', T = '2', SUB = 'ว99993', CLS = 'ม.1/97', SID = '0099793', OTHER = '0099794';
const CURRENT_ID = '0099795';
const MARK = 'REMAINING_WORKFLOW_TEST', DAY = '2037-06-01';
const TODO_OWNER = 'audit_remaining_todo_owner';
const PRIVATE_TODO = JSON.stringify([{ text: 'ข้อมูลสมมติของเจ้าของคนอื่น', done: false }]);
const data = (teacher = 'teacher1', day = 'จันทร์', period = '1') => [SUB, MARK, 'ม.1', '97', 'ห้องทดสอบ', teacher, day, period, T, Y];
async function insertSlot(teacher = 'teacher1', day = 'จันทร์', period = '1') {
  return (await query(`INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, data(teacher, day, period))).rows[0].id;
}
async function clean() {
  await query('DELETE FROM timetable WHERE level=$1 AND room=$2 AND year=$3', ['ม.1', '97', Y]);
  for (const table of ['attendance', 'subject_config', 'curriculum', 'grade_summary', 'score_database', 'score_history']) {
    await query(`DELETE FROM ${table} WHERE subject_code=$1`, [SUB]);
  }
  await query('DELETE FROM calendar_events WHERE title=$1', [MARK]);
  await query('DELETE FROM leave_records WHERE reason=$1', [MARK]);
  await query(`DELETE FROM system_settings WHERE key='todo' AND subkey=$1`, [SID]);
  await query(`DELETE FROM system_settings WHERE key='todo' AND subkey=$1`, [TODO_OWNER]);
  await query('DELETE FROM user_history WHERE username=ANY($1)', [[SID, OTHER, CURRENT_ID]]);
  await query('DELETE FROM users WHERE username=ANY($1)', [[SID, OTHER, CURRENT_ID]]);
}
before(async () => {
  await clean();
  await query(`INSERT INTO users(username,password,full_name,role,department,year,status)
    VALUES($1,'test',$2,'Student',$3,$4,'ปกติ')`, [SID, MARK, CLS, Y]);
  await query(`INSERT INTO system_settings(key,subkey,value1) VALUES('todo',$1,$2)`, [TODO_OWNER, PRIVATE_TODO]);
});
after(async () => { await clean(); await stop(); });

test('user create/read/stats/delete retains the raw ID and dedicated academic year', async () => {
  await denied('addUser', [{ username: OTHER, password: 'test', fullname: MARK, role: 'Student', department: CLS, year: Y }], 'teacher1');
  await ok('addUser', [{ username: OTHER, password: 'test', fullname: MARK, role: 'Student', department: CLS, year: Y }], 'admin');
  const users = await ok('getStudentsByClass', [CLS, Y], 'admin');
  assert.ok(users.some(r => r[0] === OTHER));
  const stats = await ok('getStudentSummaryStats', [Y], 'admin');
  assert.equal(stats.byClass[CLS], 2);
  await ok('deleteUser', [OTHER], 'admin');
  assert.equal((await query('SELECT username FROM users WHERE username=$1', [OTHER])).rows.length, 0);
});

test('timetable duplicate cleanup, swap, owner-only display edit, delete and homeroom replacement persist', async () => {
  const first = await insertSlot(), duplicate = await insertSlot(), second = await insertSlot('teacher2', 'อังคาร', '2');
  let filtered = await ok('getFilteredTimetables', ['teacher1', T, Y], 'admin');
  assert.equal(filtered.length, 2);
  const duplicates = await ok('findDuplicateTimetableRows', [T, Y], 'admin');
  assert.ok(duplicates.some(g => g.some(r => r.rowIdx === duplicate)));
  assert.equal((await ok('removeDuplicateTimetableRows', [T, Y], 'admin')).removed, 1);
  assert.equal((await query('SELECT id FROM timetable WHERE id=$1', [duplicate])).rows.length, 0);
  await ok('swapTimetableTeacher', [first, second], 'admin');
  assert.equal((await query('SELECT teacher_id FROM timetable WHERE id=$1', [first])).rows[0].teacher_id, 'teacher2');
  await denied('teacherUpdateTimetableRow', ['teacher2', first, data('teacher2')], 'teacher1');
  const edited = data('teacher2'); edited[4] = 'ห้องแก้ไข';
  await ok('teacherUpdateTimetableRow', ['teacher1', first, edited], 'teacher2');
  assert.equal((await query('SELECT location FROM timetable WHERE id=$1', [first])).rows[0].location, 'ห้องแก้ไข');
  await ok('deleteTimetableRow', [first], 'admin');
  await ok('deleteTimetableRow', [second], 'admin');
  await ok('setHomeroomTeacher', ['teacher1', CLS, T, Y], 'admin');
  await ok('setHomeroomTeacher', ['teacher2', CLS, T, Y], 'admin');
  filtered = await ok('getFilteredTimetables', ['', T, Y], 'admin');
  assert.equal(filtered.length, 5);
  assert.ok(filtered.every(r => r.data[0] === 'HR' && r.data[5] === 'teacher2' && r.data[7] === '0'));
});

test('curriculum CRUD returns the edited indicator and duplicate creation reports failure', async () => {
  const item = { subjectCode: SUB, subjectType: 'พื้นฐาน', standardCode: 'AUDIT1', description: MARK, evalType: 'ความรู้' };
  const added = await ok('addCurriculumItem', [item], 'admin');
  assert.equal((await ok('addCurriculumItem', [item], 'admin')).status, 'error');
  await ok('updateCurriculumItem', [added.id, { ...item, description: 'แก้ไขตัวชี้วัด' }], 'admin');
  assert.equal((await ok('getCurriculumBySubject', [SUB], 'teacher1'))[0].description, 'แก้ไขตัวชี้วัด');
  assert.equal((await ok('getCurriculumData', [SUB], 'admin')).length, 1);
  const count = await ok('getCurriculumCount', [], 'admin');
  assert.ok(Number(count) >= 1 || Number(count.count) >= 1);
  await ok('deleteCurriculumItem', [added.id], 'admin');
  assert.equal((await ok('getCurriculumData', [SUB], 'admin')).length, 0);
});

test('standalone subject configuration preserves zero ratios and exam indicators on readback', async () => {
  await ok('saveSubjectConfig', [{ subjectCode: SUB, className: CLS, term: T, year: Y, formative: 0, midterm: 0, final: 100,
    indicators: [], examIndicators: { final: ['AUDIT1'] } }], 'admin');
  const result = await ok('getSubjectConfig', [SUB, CLS, T, Y], 'admin');
  assert.equal(result.ratio, '0:0:100');
  assert.deepEqual(result.examIndicators, { final: ['AUDIT1'] });
});

test('calendar create/update/read/delete invalidates event cache', async () => {
  await ok('saveCalendarEvent', [{ title: MARK, start: DAY, end: '2037-06-02', color: '#dc3545' }], 'admin');
  const id = (await query('SELECT id FROM calendar_events WHERE title=$1', [MARK])).rows[0].id;
  let events = await ok('getCalendarEvents', [], 'admin'); assert.ok(events.some(r => String(r.id) === String(id)));
  await ok('saveCalendarEvent', [{ id, title: MARK, start: DAY, end: '2037-06-03', color: '#dc3545', description: 'แก้ไข' }], 'admin');
  events = await ok('getCalendarEvents', [], 'admin'); assert.equal(events.find(r => String(r.id) === String(id)).description, 'แก้ไข');
  await ok('deleteCalendarEvent', [id], 'admin');
  events = await ok('getCalendarEvents', [], 'admin'); assert.equal(events.some(r => String(r.id) === String(id)), false);
});

test('leave pending/read bundles include a dedicated request and its actual total', async () => {
  const leave = await ok('saveLeaveRequest', [{ staffName: MARK, startDate: DAY, endDate: DAY, type: 'ลาป่วย', days: 1, reason: MARK, year: Y }], 'teacher1');
  assert.ok((await ok('getPendingLeaves', [], 'admin')).some(r => String(r.leaveId) === String(leave.id)));
  const bundle = await ok('getLeaveRequestBundle', ['teacher1', Y], 'teacher1');
  assert.ok(bundle.history.some(r => String(r.leaveId) === String(leave.id)));
  assert.equal(bundle.stats.find(r => r.type === 'ลาป่วย').used, 1);
  assert.deepEqual(await ok('getPendingSubstitutes', [DAY, DAY], 'admin'), []);
  await ok('deleteLeave', [leave.id], 'teacher1');
});

test('dashboard/teacher/todo read paths return usable payloads and todo round-trips JSON', async () => {
  const admin = await ok('getAdminDashboardBundle', [], 'admin');
  for (const section of ['staffStats', 'todayStudents', 'calendarEvents', 'availableTerms', 'systemConfig']) assert.equal(admin[section].ok, true, section);
  assert.ok((await ok('getTeachersForTimetable', [], 'admin')).some(r => r.id === 'teacher1'));
  assert.ok(Array.isArray(await ok('getTeacherTimetableByDate', ['teacher1', '2026-06-01'], 'teacher1')));
  const risk = await ok('getTeacherAtRiskDashboard', ['teacher1', T, Y], 'teacher1');
  for (const name of ['critical', 'ms', 'risk']) assert.ok(Array.isArray(risk[name]));
  const json = JSON.stringify([{ text: MARK, done: false }]);
  await ok('saveTodoList', [SID, json], 'admin');
  assert.deepEqual(JSON.parse(await ok('getTodoList', [SID], 'admin')), [{ text: MARK, done: false }]);
});

test('course sessions and massive attendance grid use the requested academic year roster', async () => {
  const active = await ok('getSystemConfig', [], 'admin');
  assert.notEqual(String(active.year), Y, 'fixture requires two distinct academic years');
  await query(`INSERT INTO users(username,password,full_name,role,department,year,status)
    VALUES($1,'test','นักเรียนปีปัจจุบัน','Student',$2,$3,'ปกติ')`, [CURRENT_ID, CLS, String(active.year)]);
  require('../lib/cache').delPrefix('students_');
  await query(`INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
    VALUES($1,$2,$3,$4,$5,$6,'1',$7,$5,'มา',$8,'teacher1')`, [DAY, T, Y, SUB, MARK, CLS, SID, MARK]);
  const sessions = await ok('getCourseSessionList', ['teacher2', SUB, CLS, T, Y], 'teacher1');
  assert.equal(sessions.length, 1); assert.equal(sessions[0].studentCount, 1);
  const grid = await ok('getMassiveAttendanceGrid', ['teacher2', SUB, CLS, T, Y], 'teacher1');
  assert.equal(grid.attendance[SID][`${DAY}_1`].status, 'มา');
  assert.deepEqual(grid.students.map(r => r[0]), [SID],
    'selected-year attendance must use only that year roster, never current-year children in the same classroom');
});

test('todo reads cannot disclose another owner data through a supplied user ID', async () => {
  const response = await call('getTodoList', [TODO_OWNER], 'teacher2');
  assert.ok(response.__error, 'requesting another owner todo must be denied');
});

test('todo writes cannot overwrite another owner data through a supplied user ID', async () => {
  const response = await call('saveTodoList', [TODO_OWNER, '[]'], 'teacher2');
  const row = (await query(`SELECT value1 FROM system_settings WHERE key='todo' AND subkey=$1`, [TODO_OWNER])).rows[0];
  assert.equal(row.value1, PRIVATE_TODO, 'another owner private todo must remain unchanged');
  assert.ok(response.__error, 'writing another owner todo must be denied');
});
