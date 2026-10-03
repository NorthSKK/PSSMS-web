'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { call, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const analytics = require('../lib/usageAnalytics');
const { schoolToday } = require('../lib/schoolDate');

after(async () => {
  await query('DELETE FROM usage_analytics_daily');
  await stop();
});

test('นับ login หลังสำเร็จเท่านั้นและแยก role โดยไม่เก็บตัวตน', async () => {
  await query('DELETE FROM usage_analytics_daily');
  const failed = await call('checkLogin', ['admin', 'wrong']);
  assert.equal(failed.__result.status, 'fail');
  assert.equal((await query('SELECT count(*)::int n FROM usage_analytics_daily')).rows[0].n, 0);

  const success = await call('checkLogin', ['admin', '1234']);
  assert.equal(success.__result.status, 'success');
  const { rows } = await query('SELECT * FROM usage_analytics_daily WHERE activity_date=$1', [schoolToday()]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].login_success), 1);
  assert.equal(Number(rows[0].login_admin), 1);
  assert.equal(Number(rows[0].attendance_saved), 0);
});

test('ชุด handler ที่นับถูกกำหนดชัด และ payload ไม่มีข้อมูลผู้ใช้หรือ request', () => {
  assert.deepEqual(analytics.counterFor('saveAttendanceBatch', {}), { attendance_saved: 1 });
  assert.deepEqual(analytics.counterFor('saveAllInOneScores', {}), { scores_saved: 1 });
  assert.deepEqual(analytics.counterFor('updateTimetableRow', {}), { timetable_changed: 1 });
  assert.equal(analytics.counterFor('getStudentsByClass', {}), null);
  assert.equal(analytics.counterFor('checkLogin', { status: 'fail', role: 'Admin' }), null);

  const sent = analytics.rowPayload({
    activity_date: '2026-10-03', app_version: '1.1.0', last_activity_at: '2026-10-03T01:00:00Z',
    login_success: 1, login_admin: 1, login_teacher: 0, login_student: 0, login_executive: 0,
    attendance_saved: 2, scores_saved: 3, timetable_changed: 4,
    username: 'admin', student_id: '01901', path: '/api/gas/checkLogin', args: ['secret'], ip: '127.0.0.1',
  });
  assert.deepEqual(Object.keys(sent).sort(), [
    'app_version', 'attendance_saved', 'date', 'last_activity_at', 'login_admin',
    'login_executive', 'login_student', 'login_success', 'login_teacher',
    'scores_saved', 'timetable_changed',
  ].sort());
  assert.ok(!JSON.stringify(sent).includes('01901'));
  assert.ok(!JSON.stringify(sent).includes('secret'));
});

test('ส่งล้มเหลวไม่ทำข้อมูลหาย และรอบถัดไปส่ง cumulative row เดิมซ้ำได้', async (t) => {
  await query('DELETE FROM usage_analytics_daily');
  await analytics.recordSuccessfulCall('checkLogin', { status: 'success', role: 'Teacher' });
  const oldUrl = process.env.PSSMS_ANALYTICS_INGEST_URL;
  const oldToken = process.env.PSSMS_ANALYTICS_INGEST_TOKEN;
  process.env.PSSMS_ANALYTICS_INGEST_URL = 'http://analytics.test';
  process.env.PSSMS_ANALYTICS_INGEST_TOKEN = 'deployment-token';
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    attempts++;
    assert.equal(url, 'http://analytics.test/api/analytics/ingest/daily');
    assert.equal(init.headers.Authorization, 'Bearer deployment-token');
    const body = JSON.parse(init.body);
    assert.equal(body.login_success, 1);
    assert.equal(body.login_teacher, 1);
    assert.deepEqual(Object.keys(body).sort(), [
      'app_version', 'attendance_saved', 'date', 'last_activity_at', 'login_admin',
      'login_executive', 'login_student', 'login_success', 'login_teacher',
      'scores_saved', 'timetable_changed',
    ].sort());
    return attempts === 1 ? new Response('{}', { status: 503 }) : Response.json({ accepted: true });
  });
  try {
    await analytics.dispatchPending();
    let row = (await query('SELECT last_sent_at FROM usage_analytics_daily')).rows[0];
    assert.equal(row.last_sent_at, null);
    await analytics.dispatchPending();
    row = (await query('SELECT last_sent_at FROM usage_analytics_daily')).rows[0];
    assert.ok(row.last_sent_at);
    assert.equal(attempts, 2);
  } finally {
    if (oldUrl === undefined) delete process.env.PSSMS_ANALYTICS_INGEST_URL;
    else process.env.PSSMS_ANALYTICS_INGEST_URL = oldUrl;
    if (oldToken === undefined) delete process.env.PSSMS_ANALYTICS_INGEST_TOKEN;
    else process.env.PSSMS_ANALYTICS_INGEST_TOKEN = oldToken;
  }
});
