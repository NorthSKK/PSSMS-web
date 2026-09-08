'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');

after(stop);

test('แดชบอร์ดผู้บริหารเปิดได้เฉพาะ Admin และ Executive', async () => {
  // เรียกตามลำดับ: test helper เปิด Express แบบ lazy และไม่รองรับ start พร้อมกัน
  const admin = await ok('getExecutiveDashboardBundle', [], 'admin');
  const executive = await ok('getExecutiveDashboardBundle', [], 'executive');

  assert.equal(admin.kpi.ok, true);
  assert.equal(executive.kpi.ok, true);
  assert.equal(executive.kpi.data.studentCount, admin.kpi.data.studentCount,
    'Executive ต้องเห็นจำนวนนักเรียนทั้งโรงเรียนเท่ากับ Admin');
  assert.equal(executive.kpi.data.teacherCount, admin.kpi.data.teacherCount,
    'Executive ต้องเห็นจำนวนบุคลากรทั้งโรงเรียนเท่ากับ Admin');

  assert.match(await denied('getExecutiveDashboardBundle', [], 'teacher1'), /สงวนสิทธิ์/);
  assert.match(await denied('getExecutiveDashboardBundle', [], 'student'), /สงวนสิทธิ์/);
});

test('แดชบอร์ดผู้บริหารคืนข้อมูลครบตามสัญญาของหน้าเว็บ', async () => {
  const bundle = await ok('getExecutiveDashboardBundle', ['วิชาการ'], 'executive');

  for (const name of ['kpi', 'academic', 'budget', 'personnel', 'general', 'calendar']) {
    assert.equal(typeof bundle[name]?.ok, 'boolean', `${name} ต้องมีสถานะของตัวเอง`);
  }
  assert.equal(bundle.kpi.ok, true);
  assert.deepEqual(
    Object.keys(bundle.kpi.data).sort(),
    ['attPct', 'budgetUsedPct', 'studentCount', 'teacherCount', 'todayPresent', 'todayTotal'].sort()
  );
  assert.equal(Array.isArray(bundle.academic.data.trend), true);
  assert.equal(bundle.academic.data.trend.length, 7, 'แนวโน้มต้องมีครบ 7 วัน รวมวันที่ไม่มีข้อมูล');
  assert.equal(Array.isArray(bundle.academic.data.noAttendanceTeachers), true);
  assert.equal(Array.isArray(bundle.budget.data.projects), true);
  assert.equal(typeof bundle.personnel.data.leaveByType, 'object');
  assert.equal(Array.isArray(bundle.general.data.recent), true);
});
