'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { call, ok, denied, stop } = require('./helpers/api');
const { TERM, YEAR, PHYSICS, HEALTH, M2_STUDENTS, M6_STUDENTS } = require('./helpers/fixtures');

after(stop);

test('ไม่มี token → Unauthorized', async () => {
  const res = await call('getSubjectConfig', [PHYSICS.code, PHYSICS.className, TERM, YEAR]);
  assert.equal(res.__error, 'Unauthorized');
});

test('token ปลอม → ปฏิเสธ', async () => {
  const res = await call('getSubjectConfig', [PHYSICS.code, PHYSICS.className, TERM, YEAR], 'not.a.jwt');
  assert.match(res.__error, /invalid|expired/i);
});

test('PUBLIC_FNS เรียกได้โดยไม่ต้อง token', async () => {
  const res = await call('getSystemConfig', []);
  assert.equal(res.__error, undefined);
});

test('ครูเขียนคะแนนวิชาที่ตัวเองสอนได้', async () => {
  const res = await ok('saveAllInOneScores', [
    [{ studentId: '01901', indicatorId: 'formative_0', score: '21' }],
    PHYSICS.code, TERM, YEAR,
  ], 'teacher1');
  assert.equal(res.status, 'success');
});

test('ครูคนอื่นเขียนคะแนนวิชาที่ไม่ได้สอนไม่ได้', async () => {
  await denied('saveAllInOneScores', [
    [{ studentId: '01901', indicatorId: 'formative_0', score: '99' }],
    PHYSICS.code, TERM, YEAR,
  ], 'teacher2');
});

test('ADMIN_ONLY ปฏิเสธครู', async () => {
  const msg = await denied('getAllUsers', [], 'teacher1');
  assert.match(msg, /สิทธิ|permission|admin/i);
});

test('Student เรียก TEACHER_OR_ADMIN ไม่ได้', async () => {
  await denied('saveAttendanceBatch', [[{
    date: '2026-05-20', term: TERM, year: YEAR,
    subjectCode: HEALTH.code, subjectName: HEALTH.name, className: HEALTH.className,
    period: '3', studentId: '02001', studentName: 'x', status: 'มา',
  }]], 'student');
});

test('Admin bypass ownership check', async () => {
  const res = await ok('saveAllInOneScores', [
    [{ studentId: '01901', indicatorId: 'formative_0', score: '22' }],
    PHYSICS.code, TERM, YEAR,
  ], 'admin');
  assert.equal(res.status, 'success');
});

// ---------------------------------------------------------------------------
// นักเรียนอ่านข้อมูลของนักเรียนคนอื่นไม่ได้
//
// endpoint กลุ่มนี้รับ studentId มาจาก payload ซึ่งเชื่อไม่ได้ — เคยหลุดมาแล้ว
// ทั้งสี่ตัว นักเรียนเปลี่ยนตัวเลขใน request แล้วอ่านเกรด ยอดเงินออม ประวัติ
// ธุรกรรม และชุมนุมของเพื่อนได้ทั้งห้อง
//
// ครูและผู้ดูแลต้องยังดูได้ตามหน้าที่ เทสต์จึงต้องยืนยันทั้งสองด้าน
// เพิ่ม endpoint ใหม่ที่รับ studentId เมื่อไหร่ ให้เพิ่มชื่อในลิสต์นี้ด้วย

const SELF = M2_STUDENTS[0];      // นักเรียนที่ล็อกอิน (test/helpers/api.js ใช้คนนี้)
const OTHER = M6_STUDENTS[0];     // เพื่อนคนละห้อง

const STUDENT_SCOPED = [
  ['getSavingsBalance',          (id) => [id]],
  ['getSavingsHistory',          (id) => [id]],
  ['getMyClub',                  (id) => [id, TERM, YEAR]],
  ['getStudentDashboardBundle',  (id) => [id, TERM, YEAR]],
];

for (const [fnName, argsFor] of STUDENT_SCOPED) {
  test(`${fnName}: นักเรียนขอข้อมูลของคนอื่น ต้องได้ของตัวเองแทน`, async () => {
    const asOther = await ok(fnName, argsFor(OTHER), 'student');
    const asSelf  = await ok(fnName, argsFor(SELF),  'student');
    assert.deepEqual(asOther, asSelf,
      `${fnName} ยอมให้นักเรียนอ่านข้อมูลของ ${OTHER} — รหัสใน payload ต้องถูกทิ้ง`);
  });
}

test('ครูยังดูข้อมูลของนักเรียนได้ตามหน้าที่', async () => {
  const bal = await ok('getSavingsBalance', [OTHER], 'teacher2');
  assert.ok(bal && bal.studentId, 'ครูต้องได้สมุดของนักเรียนที่ระบุ ไม่ใช่ของตัวเอง');
  const hist = await ok('getSavingsHistory', [OTHER], 'teacher2');
  assert.ok(Array.isArray(hist));
});

// ---------------------------------------------------------------------------
// bundle ที่ห่อ error ไว้ ต้องไม่รายงานว่าสำเร็จทั้งที่ query พัง
//
// getStudentDashboardBundle จับ error ใส่ { ok:false } แล้วคืน 200 เสมอ
// เคยมี query อ้างคอลัมน์ที่ไม่มีอยู่จริง (sc.subject_name) พังทุกครั้งอยู่นาน
// โดยหน้าเว็บแสดงแค่ว่าไม่มีข้อมูล ไม่มีอะไรฟ้องว่าพัง

test('แดชบอร์ดนักเรียน: ทุกส่วนต้อง ok ไม่ใช่ error ที่ถูกกลืน', async () => {
  const b = await ok('getStudentDashboardBundle', [SELF, TERM, YEAR], 'student');
  for (const [key, part] of Object.entries(b)) {
    if (part && typeof part === 'object' && 'ok' in part) {
      assert.equal(part.ok, true, `${key} พังเงียบ: ${part.error}`);
    }
  }
});

// ---------------------------------------------------------------------------
// รูปร่างที่ส่งให้หน้านักเรียน ต้องตรงกับที่ _renderScoreFeed อ่าน
//
// เคยพังมาแล้วสองชั้นซ้อน: query อ้างคอลัมน์ที่ไม่มี ทำให้ไม่มีใครเห็นว่า
// renderer ก็ไม่ตรงกับ payload ด้วย พอแก้ query ชั้นแรก หน้าเว็บก็ค้างที่
// skeleton เพราะ renderer เรียก subj.items.forEach บนค่า undefined
//
// เทสต์นี้ล็อก contract ไว้ — แก้ฝั่งไหนแล้วอีกฝั่งไม่ตาม จะแดงที่นี่

test('แดชบอร์ดนักเรียน: payload ต้องมีคีย์ครบตามที่หน้าเว็บใช้', async () => {
  const b = await ok('getStudentDashboardBundle', [SELF, TERM, YEAR], 'student');

  assert.ok(b.kpi && b.kpi.ok, 'ต้องมี kpi สำหรับแถบร้อยละการมาเรียนและเกรดเฉลี่ย');
  assert.ok('attendancePercent' in b.kpi.data, 'ไม่มี attendancePercent → ช่องบนหน้าเว็บจะเป็นขีดตลอด');
  assert.ok('gpa' in b.kpi.data);

  for (const subj of b.scoreFeed.data) {
    for (const key of ['subjectCode', 'subjectName', 'className', 'totalScore', 'grade', 'items']) {
      assert.ok(key in subj, `scoreFeed ขาดคีย์ ${key} — _renderScoreFeed อ่านคีย์นี้`);
    }
    assert.ok(Array.isArray(subj.items),
      'items ต้องเป็น array เสมอ — renderer เรียก .forEach ทันทีโดยไม่เช็ค');
    for (const it of subj.items) {
      for (const key of ['type', 'name', 'maxScore']) {
        assert.ok(key in it, `รายการคะแนนขาดคีย์ ${key}`);
      }
      assert.ok(['formative', 'midterm', 'final'].includes(it.type),
        `type '${it.type}' ไม่อยู่ในกลุ่มที่ renderer รู้จัก จะไม่ถูกแสดงเลย`);
    }
  }
});
