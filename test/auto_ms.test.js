/**
 * มส. อัตโนมัติจากเวลาเรียน (functions/autoMs.js)
 *
 * ครอบกติกาที่ตัดสินใจไว้ว่าใครชนะใคร: ครู > ระบบ, ระบบถอนคืนของตัวเองได้,
 * และการเช็คชื่อต้องสำเร็จเสมอแม้ขั้นนี้พัง
 *
 * ⚠️ ไฟล์นี้ล้าง attendance ของ ว30205 ทิ้งระหว่างเทส แล้ว **คืนของ seed ใน after()**
 * (ล้อ test/import.test.js) — ไฟล์เทสอื่นบน DB เดียวกันนับคาบจากแถวชุดนี้
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR, PHYSICS } = require('./helpers/fixtures');
const autoMs = require('../functions/autoMs');

const SUB = PHYSICS.code;
const CLS = PHYSICS.className;
// 0 นำหน้าโดยตั้งใจ — normID() จะตัดเป็น '1903' คีย์ที่คุยกับ DB ต้องเป็น id ดิบ
const STD = '01903';
const STD_NAME = 'เด็กชายทดสอบ ขาดเรียน';

// ว30205 มี 3 คาบ/สัปดาห์ ใน seed → totalCoursePeriods = 3 × 20 = 60
// โควตาขาดได้ 20% = 12 คาบ · ขาด 13 คาบ → 78.33% ซึ่งต่ำกว่าเกณฑ์ 80%
const TOTAL_PERIODS = 60;
const ABSENCES_FOR_MS = 13;

let _attBackup = [];

before(async () => {
  const { rows } = await query(
    `SELECT to_char(date,'YYYY-MM-DD') AS date, term, year, subject_code, subject_name,
            class, period, student_id, student_name, status, session_id, teacher_id
       FROM attendance WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [SUB, TERM, YEAR]
  );
  _attBackup = rows;
});

after(async () => {
  await resetSubject();
  for (const r of _attBackup) {
    await query(
      `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [r.date, r.term, r.year, r.subject_code, r.subject_name, r.class, r.period,
       r.student_id, r.student_name, r.status, r.session_id, r.teacher_id]
    );
  }
  await stop();
});

async function resetSubject() {
  await query(`DELETE FROM attendance WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  await query(`DELETE FROM grade_summary WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  await query(
    `DELETE FROM score_database WHERE subject_code=$1 AND term=$2 AND year=$3 AND indicator_id='remark'`,
    [SUB, TERM, YEAR]
  );
}

// วันที่คงที่ ไม่ผูกกับ "วันนี้" — getSemesterReport นับจากแถวใน attendance ล้วน
const DAY = (n) => `2026-06-${String(n).padStart(2, '0')}`;

/** ใส่คาบที่เช็คแล้วตรง ๆ ลง DB (เร็วกว่ายิง HTTP ทีละคาบ) */
async function seedSessions(count, status, studentId = STD) {
  for (let i = 1; i <= count; i++) {
    const date = DAY(i);
    await query(
      `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,'1',$7,$8,$9,$10,'teacher1')`,
      [date, TERM, YEAR, SUB, PHYSICS.name, CLS, studentId, STD_NAME, status,
       `${date}|${SUB}|${CLS}|1`]
    );
  }
}

/** เช็คชื่อผ่าน HTTP จริง — จังหวะที่ hook มส. อัตโนมัติทำงาน */
const checkIn = (dayNo, status, studentId = STD) => ok('saveAttendanceBatch', [[{
  date: DAY(dayNo), term: TERM, year: YEAR,
  subjectCode: SUB, subjectName: PHYSICS.name, className: CLS,
  period: '1', studentId, studentName: STD_NAME, status,
}]], 'teacher1');

async function readGrade(studentId = STD) {
  const { rows } = await query(
    `SELECT grade, ms_source, attendance_percent FROM grade_summary
      WHERE student_id=$1 AND subject_code=$2 AND term=$3 AND year=$4`,
    [studentId, SUB, TERM, YEAR]
  );
  return rows[0] || null;
}

// ── 1. เช็คชื่อจนเวลาเรียนต่ำกว่า 80% → แถวขึ้นเอง ────────────────────────────

test('ขาดจนเวลาเรียน <80% → ระบบเขียน มส ให้เองตอนเช็คชื่อ', async () => {
  await resetSubject();
  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  assert.equal(await readGrade(), null, 'ยังไม่ถึงเกณฑ์ ต้องไม่มีแถว');

  await checkIn(ABSENCES_FOR_MS, 'ขาด');

  const g = await readGrade();
  assert.ok(g, 'ถึงเกณฑ์แล้วต้องมีแถวใน grade_summary');
  assert.equal(g.grade, 'มส');
  assert.equal(g.ms_source, 'auto');
  const expected = ((TOTAL_PERIODS - ABSENCES_FOR_MS) / TOTAL_PERIODS) * 100;
  assert.ok(Math.abs(Number(g.attendance_percent) - expected) < 0.02,
    `เปอร์เซ็นต์ต้องมาจากสูตรเดียวกับ getSemesterReport (ได้ ${g.attendance_percent})`);
});

test('ลา นับรวมกับขาดเหมือน getSemesterReport (totalMissed = absent + leave)', async () => {
  await resetSubject();
  await seedSessions(6, 'ขาด');
  // เหลืออีก 7 คาบเป็น "ลา" — รวมแล้ว 13 ยังต่ำกว่าเกณฑ์เหมือนกัน
  for (let i = 7; i <= ABSENCES_FOR_MS - 1; i++) {
    const date = DAY(i);
    await query(
      `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,'1',$7,$8,'ลา',$9,'teacher1')`,
      [date, TERM, YEAR, SUB, PHYSICS.name, CLS, STD, STD_NAME, `${date}|${SUB}|${CLS}|1`]
    );
  }
  await checkIn(ABSENCES_FOR_MS, 'ลา');
  assert.equal((await readGrade()).grade, 'มส');
});

// ── 2. ครูชนะเสมอ ──────────────────────────────────────────────────────────

test('ครูตั้ง remark เองแล้ว ระบบต้องไม่ทับ', async () => {
  await resetSubject();
  await ok('saveAllInOneScores',
    [[{ studentId: STD, indicatorId: 'remark', score: 'ร' }], SUB, TERM, YEAR], 'teacher1');

  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');

  assert.equal(await readGrade(), null,
    'ครูตัดสินไว้ว่า ร แล้ว ระบบต้องไม่เขียนแถว มส ทับ');
});

test("remark '-' ไม่ใช่การตัดสินของครู — ระบบยังเขียน มส ได้", async () => {
  await resetSubject();
  await ok('saveAllInOneScores',
    [[{ studentId: STD, indicatorId: 'remark', score: '-' }], SUB, TERM, YEAR], 'teacher1');

  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');

  assert.equal((await readGrade()).ms_source, 'auto');
});

test('แถวที่ครูเขียนไว้แล้ว (ms_source NULL) ระบบห้ามแตะทั้งทับและลบ', async () => {
  await resetSubject();
  await query(
    `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,remedial_status,term,year)
     VALUES($1,$2,88,'4','',$3,$4)`,
    [STD, SUB, TERM, YEAR]
  );

  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');

  const g = await readGrade();
  assert.equal(g.grade, '4', 'เกรดที่ครูตัดสินต้องอยู่เหมือนเดิม');
  assert.equal(g.ms_source, null);
});

test('ครูกดบันทึก ปพ.5 ทับแถว auto → แถวกลายเป็นของครู แล้วระบบไม่ถอนคืนอีก', async () => {
  await resetSubject();
  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');
  assert.equal((await readGrade()).ms_source, 'auto');

  // seed ตั้ง ratio 50:20:30 + formative 2 ตัว — กรอกครบเพื่อผ่าน completeness gate
  await ok('saveAllInOneWithConfig', [{
    subjectCode: SUB, className: CLS, term: TERM, year: YEAR,
    newConfig: {
      formative: 50, midterm: 20, final: 30,
      indicators: [
        { code: '', name: 'ชิ้นงานที่ 1', score: 25, description: '' },
        { code: '', name: 'ชิ้นงานที่ 2', score: 25, description: '' },
      ],
    },
    scoreRecords: [
      { studentId: STD, indicatorId: 'formative_0', score: '25' },
      { studentId: STD, indicatorId: 'formative_1', score: '20' },
      { studentId: STD, indicatorId: 'midterm', score: '18' },
      { studentId: STD, indicatorId: 'final', score: '25' },
      { studentId: STD, indicatorId: 'remark', score: '-' },
    ],
    gradeRecords: [{ studentId: STD, totalScore: 88, grade: '4', remark: '' }],
  }], 'teacher1');

  let g = await readGrade();
  assert.equal(g.grade, '4');
  assert.equal(g.ms_source, null, 'ครูบันทึกแล้วแถวต้องเลิกเป็นของระบบ');

  // เวลาเรียนกลับขึ้น — แถวของครูต้องไม่ถูกถอน
  await query(`UPDATE attendance SET status='มา' WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [SUB, TERM, YEAR]);
  await checkIn(ABSENCES_FOR_MS, 'มา');
  g = await readGrade();
  assert.ok(g && g.grade === '4', 'แถวของครูต้องยังอยู่');
});

test('autosave ปพ.5 ที่กรอกไม่ครบ ต้องไม่ลบแถว auto ทิ้ง', async () => {
  await resetSubject();
  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');
  assert.equal((await readGrade()).ms_source, 'auto');

  await ok('saveAllInOneWithConfig', [{
    subjectCode: SUB, className: CLS, term: TERM, year: YEAR,
    newConfig: {
      formative: 50, midterm: 20, final: 30,
      indicators: [
        { code: '', name: 'ชิ้นงานที่ 1', score: 25, description: '' },
        { code: '', name: 'ชิ้นงานที่ 2', score: 25, description: '' },
      ],
    },
    scoreRecords: [{ studentId: STD, indicatorId: 'formative_0', score: '10' }],
    gradeRecords: [{ studentId: STD, totalScore: 10, grade: '0', remark: '' }],
  }], 'teacher1');

  const g = await readGrade();
  assert.ok(g && g.ms_source === 'auto', 'แถวที่ระบบเติมให้ต้องยังอยู่');
});

// ── 3. ถอนคืนเมื่อ % กลับขึ้น ─────────────────────────────────────────────────

test('เวลาเรียนกลับขึ้น ≥80% → แถว auto ถูกถอนคืน ไม่ใช่ค้าง', async () => {
  await resetSubject();
  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');
  assert.equal((await readGrade()).ms_source, 'auto');

  // ครูแก้ที่เช็คผิดย้อนหลัง — ขาดเหลือ 0 คาบ
  await query(`UPDATE attendance SET status='มา' WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [SUB, TERM, YEAR]);
  await checkIn(ABSENCES_FOR_MS, 'มา');

  assert.equal(await readGrade(), null, 'ระบบต้องลบแถวของตัวเองทิ้ง');
});

// ── 4. โฮมรูม / แนะแนว / ชุมนุม ไม่เข้าระบบนี้ ───────────────────────────────

test('HR / - / CLUB_* ไม่ใช่รายวิชาที่มีเกรด', async () => {
  assert.equal(autoMs.isGradedSubject('HR'), false);
  assert.equal(autoMs.isGradedSubject('-'), false);
  assert.equal(autoMs.isGradedSubject('CLUB_123'), false);
  assert.equal(autoMs.isGradedSubject(SUB), true);

  for (const code of ['HR', '-', 'CLUB_123']) {
    const plan = await autoMs.planAutoMs({ subjectCode: code, className: CLS, term: TERM, year: YEAR });
    assert.equal(plan.eligible, false, `${code} ต้องถูกตัดออกก่อนแตะ DB`);
    assert.deepEqual(plan.toWrite, []);
  }
});

test('บันทึกตารางเช็คชื่อโฮมรูมแล้วต้องไม่มีแถว grade_summary ของ HR', async () => {
  const res = await ok('saveMassiveAttendanceGrid',
    ['HR', 'กิจกรรมโฮมรูมหน้าเสาธง', 'ม.2/1', TERM, YEAR, [], []], 'teacher2');
  assert.equal(res.status, 'success');
  const { rows } = await query(
    `SELECT 1 FROM grade_summary WHERE subject_code='HR' AND term=$1 AND year=$2`, [TERM, YEAR]);
  assert.equal(rows.length, 0);
});

// ── 5. ขั้นนี้พังต้องไม่ล้มการเช็คชื่อ ─────────────────────────────────────────

test('auto-มส พัง → ครูยังเช็คชื่อได้ตามปกติ', async () => {
  await resetSubject();
  const origSync = autoMs.syncAutoMs;
  const origErr = console.error;
  autoMs.syncAutoMs = () => Promise.reject(new Error('จงใจพังเพื่อทดสอบ'));
  console.error = () => {};
  try {
    const res = await checkIn(1, 'ขาด');
    assert.equal(res.status, 'success');
    assert.equal(res.saved, 1);
  } finally {
    autoMs.syncAutoMs = origSync;
    console.error = origErr;
  }

  const { rows } = await query(
    `SELECT status FROM attendance WHERE session_id=$1`, [`${DAY(1)}|${SUB}|${CLS}|1`]);
  assert.equal(rows.length, 1, 'แถวเช็คชื่อต้องถูกบันทึกจริง');
  assert.equal(rows[0].status, 'ขาด');
});

// ── 6. รูปข้อมูลที่หน้าเว็บใช้ติดป้าย ────────────────────────────────────────

test('การ์ดกลุ่มเสี่ยงและหน้า ปพ.5 ต้องแยกออกว่าแถวไหนระบบเติมให้', async () => {
  await resetSubject();
  await seedSessions(ABSENCES_FOR_MS - 1, 'ขาด');
  await checkIn(ABSENCES_FOR_MS, 'ขาด');

  const risk = await ok('getTeacherRiskDashboard', ['teacher1', TERM, YEAR], 'teacher1');
  const hit = risk.details.find(d => d.subjectCode === SUB && d.type === 'มส');
  assert.ok(hit, 'แถว มส ต้องขึ้นการ์ดกลุ่มเสี่ยง');
  assert.equal(hit.auto, true);
  assert.ok(hit.attendancePercent < 80);

  const grid = await ok('getAllInOneScoreGridData', [SUB, CLS, TERM, YEAR], 'teacher1');
  // key เป็น normID เหมือน attStats/existingScores ในไฟล์เดียวกัน
  assert.equal(grid.autoMs['1903'], true);
});
