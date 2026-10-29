'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const Y = '2579', T = '2', DAY = '2036-06-02', CLS = 'ม.1/98', SID = '0099792';
const MARK = 'BROAD_WORKFLOW_TEST', PROJECT = 'budget_broad_workflow';
let clubId;
async function clean() {
  await query('DELETE FROM substitute_assignments WHERE note=$1', [MARK]);
  await query('DELETE FROM leave_records WHERE reason=$1', [MARK]);
  await query('DELETE FROM budgets WHERE project_id=$1', [PROJECT]);
  await query('DELETE FROM savings_transactions WHERE student_id=$1', ['99792']);
  await query('DELETE FROM morning_activity WHERE class=$1 AND year=$2', [CLS, Y]);
  await query('DELETE FROM detailed_lesson_records WHERE session_id=$1', [MARK]);
  await query('DELETE FROM clubs WHERE club_name=$1', [MARK]);
  await query('DELETE FROM users WHERE username=$1', [SID]);
}
before(async () => {
  await clean();
  await query(`INSERT INTO users(username,password,full_name,role,department,year,status)
    VALUES($1,'test','นักเรียนทดสอบเวิร์กโฟลว์','Student',$2,$3,'ปกติ')`, [SID, CLS, Y]);
});
after(async () => { await clean(); await stop(); });

test('leave request/review/edit/delete and substitute confirmation form a real lifecycle', async () => {
  const leave = { staffName: 'ครูทดสอบ', type: 'ลาป่วย', startDate: DAY, endDate: DAY, days: 1, reason: MARK, year: Y };
  const created = await ok('saveLeaveRequest', [leave], 'teacher1');
  await denied('updateLeave', [created.id, leave], 'teacher2');
  await ok('updateLeave', [created.id, { ...leave, type: 'ลากิจ' }], 'teacher1');
  await ok('rejectLeave', [created.id, 'forged', 'พิจารณาใหม่'], 'admin');
  let row = (await query('SELECT type,status,reviewed_by FROM leave_records WHERE id=$1', [created.id])).rows[0];
  assert.deepEqual(row, { type: 'ลากิจ', status: 'ปฏิเสธ', reviewed_by: 'admin' });
  await ok('approveLeave', [created.id, 'forged', 'อนุมัติ'], 'admin');
  const sub = await ok('saveSubstituteAssignment', [{ leaveId: created.id, date: DAY, period: '1', dayOfWeek: 'จันทร์',
    originalTeacherId: 'teacher1', subTeacherId: 'teacher2', subjectCode: 'ว99992', subjectName: MARK, class: CLS, note: MARK }], 'admin');
  await denied('confirmSubstitute', [sub.id], 'teacher1');
  await ok('confirmSubstitute', [sub.id], 'teacher2');
  assert.equal((await query('SELECT status FROM substitute_assignments WHERE id=$1', [sub.id])).rows[0].status, 'ยืนยันแล้ว');
  await ok('deleteLeave', [created.id], 'teacher1');
  assert.equal((await query('SELECT id FROM leave_records WHERE id=$1', [created.id])).rows.length, 0);
  row = (await query('SELECT status,leave_id FROM substitute_assignments WHERE id=$1', [sub.id])).rows[0];
  assert.deepEqual(row, { status: 'ยกเลิก', leave_id: null });
  const onBehalf = await ok('adminCreateLeave', [{ ...leave, teacherId: 'teacher2', status: 'รอพิจารณา' }], 'admin');
  assert.equal(onBehalf.approved, false);
  assert.equal((await query('SELECT teacher_id FROM leave_records WHERE id=$1', [onBehalf.id])).rows[0].teacher_id, 'teacher2');
  const listed = await ok('getAllLeaves', [Y, ''], 'admin');
  assert.ok(listed.some(r => String(r.leaveId) === String(onBehalf.id)));
  await ok('deleteLeave', [onBehalf.id], 'admin');
});

test('budget create/edit enforces ownership and calculates the persisted balance', async () => {
  const data = { projectId: PROJECT, projectName: MARK, budgetAmount: 1000, usedAmount: 200, year: Y };
  await ok('saveBudget', [data], 'teacher1');
  await denied('saveBudget', [{ ...data, usedAmount: 999 }], 'teacher2');
  await ok('saveBudget', [{ ...data, usedAmount: 350 }], 'teacher1');
  const list = await ok('getBudgets', [Y], 'admin');
  const budget = list.find(r => r.projectId === PROJECT);
  assert.equal(budget.balance, 650); assert.equal(budget.usedAmount, 350);
  assert.equal((await query('SELECT created_by FROM budgets WHERE project_id=$1', [PROJECT])).rows[0].created_by, 'teacher1');
});

test('savings deposit/withdraw/import/delete agree with individual and classroom balances', async () => {
  const data = type => ({ studentId: SID, studentName: MARK, class: CLS, type, amount: type === 'deposit' ? 100 : 25 });
  const saved = await ok('saveSavingsTransaction', [[data('deposit'), data('withdraw')], T, Y], 'teacher1');
  assert.equal(saved.saved, 2);
  assert.equal((await ok('getSavingsBalance', [SID], 'teacher1')).balance, 75);
  const summary = await ok('getSavingsSummary', [CLS], 'teacher1');
  assert.equal(summary.students.find(r => r.studentId === '99792').balance, 75);
  const csv = `timestamp,student_id,student_name,type,amount\n${DAY},${SID},${MARK},deposit,15`;
  assert.equal((await ok('importSavingsCSV', [csv, T, Y], 'admin')).inserted, 1);
  assert.equal((await ok('importSavingsCSV', [csv, T, Y], 'admin')).skipped, 1);
  assert.equal((await ok('getSavingsBalance', [SID], 'teacher1')).balance, 90);
  const history = await ok('getSavingsHistory', [SID], 'teacher1');
  assert.equal(history.length, 3);
  const withdrawal = history.find(r => r.type === 'withdraw');
  await denied('deleteSavingsTransaction', [withdrawal.id], 'teacher1');
  await ok('deleteSavingsTransaction', [withdrawal.id], 'admin');
  assert.equal((await ok('getSavingsBalance', [SID], 'teacher1')).balance, 115);
  assert.equal((await ok('getClassListForSavings', [], 'teacher1')).includes(CLS), true);
});

test('morning check-in saves and replaces only the teacher session and reads canonical statuses', async () => {
  const payload = { date: DAY, term: T, year: Y, className: CLS, teacherId: 'teacher2',
    records: [{ studentId: SID, studentName: MARK, area: 'ปกติ', duty: 'ทำหน้าที่', flag: 'เข้าแถว' }] };
  await ok('saveMorningActivityBatch', [payload], 'teacher1');
  let saved = (await query('SELECT teacher_id FROM morning_activity WHERE class=$1 AND year=$2', [CLS, Y])).rows;
  assert.deepEqual(saved, [{ teacher_id: 'teacher1' }]);
  const read = await ok('getMorningActivityData', [DAY, CLS], 'teacher1');
  assert.deepEqual(read[SID], { area: 'ปกติ', duty: 'ทำหน้าที่', flag: 'เข้าแถว' });
  payload.records[0].flag = 'ไม่เข้าแถว';
  await ok('saveMorningActivityBatch', [payload], 'teacher1');
  saved = (await query('SELECT flag_status FROM morning_activity WHERE class=$1 AND year=$2', [CLS, Y])).rows;
  assert.deepEqual(saved, [{ flag_status: 'ไม่เข้าแถว' }]);
  const summary = await ok('getTodayMorningSummary', [DAY, 'teacher1'], 'teacher1');
  const classroom = summary.find(r => r.className === CLS);
  assert.deepEqual(classroom, { className: CLS, areaOk: 1, dutyOk: 1, flagOk: 0, total: 1 },
    'canonical normal area/duty statuses must count in the daily morning summary');
});

test('detailed lesson CRUD round-trips structured fields and rejects another teacher edits', async () => {
  const record = { date: DAY, term: T, year: Y, subjectCode: 'ว99992', subjectName: MARK, className: CLS,
    period: '1', topic: 'หัวข้อแรก', outcomes: 'เรียนรู้', dpaIndicators: ['1'], skills3r8c: ['C1'], sessionId: MARK };
  await ok('saveDetailedLessonRecord', [record], 'teacher1');
  let rows = await ok('getDetailedLessonRecords', ['teacher2', T, Y], 'teacher1');
  const row = rows.find(r => r.sessionId === MARK); assert.ok(row);
  assert.deepEqual(row.dpaIndicators, ['1']);
  await denied('updateDetailedLessonRecord', [row.timestamp, { ...record, topic: 'ห้ามแก้' }], 'teacher2');
  await ok('updateDetailedLessonRecord', [row.timestamp, { ...record, topic: 'หัวข้อแก้ไข' }], 'teacher1');
  rows = await ok('getDetailedLessonRecords', ['teacher2', T, Y], 'teacher1');
  assert.equal(rows.find(r => r.timestamp === row.timestamp).topic, 'หัวข้อแก้ไข');
  await denied('deleteDetailedLessonRecord', [row.timestamp], 'teacher2');
  await ok('deleteDetailedLessonRecord', [row.timestamp], 'teacher1');
  assert.equal((await query('SELECT id FROM detailed_lesson_records WHERE session_id=$1', [MARK])).rows.length, 0);
});

test('club create/advisor edit/member remove/delete refresh list and preserve membership truth', async () => {
  const created = await ok('createClub', [{ clubName: MARK, capacity: 10, term: T, year: Y,
    advisors: [{ teacherId: 'teacher1', teacherName: 'ครูทดสอบ' }] }], 'admin');
  clubId = created.clubId;
  await denied('updateClub', [{ clubId, term: T, year: Y, description: 'ห้ามแก้' }], 'teacher2');
  await ok('updateClub', [{ clubId, term: T, year: Y, capacity: 12, advisors: [{ teacherId: 'teacher1', teacherName: 'ครูทดสอบใหม่' }] }], 'teacher1');
  let list = await ok('getClubList', [T, Y], 'admin');
  assert.equal(list.find(r => r.clubId === clubId).capacity, 12);
  assert.equal(list.find(r => r.clubId === clubId).advisors[0].teacherName, 'ครูทดสอบใหม่');
  await ok('adminAddMember', [clubId, SID], 'admin');
  assert.equal((await ok('getClubMembers', [clubId, T, Y], 'admin'))[0].studentId, SID);
  list = await ok('getClubList', [T, Y], 'admin'); assert.equal(list.find(r => r.clubId === clubId).memberCount, 1);
  await ok('adminRemoveMember', [clubId, SID], 'admin');
  assert.equal((await ok('getClubMembers', [clubId, T, Y], 'admin')).length, 0);
  await ok('deleteClub', [clubId], 'admin');
  list = await ok('getClubList', [T, Y], 'admin'); assert.equal(list.some(r => r.clubId === clubId), false);
});
