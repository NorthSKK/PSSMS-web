/**
 * สรุปเกรดส่งรายงาน (functions/finalGrades.js)
 *
 * ครูกดยืนยันท้ายเทอม = ปลด completeness gate: ช่องว่างนับเป็น 0 เหมือนหน้า ปพ.5
 * seed: ม.6/1 ทุกคนมีแค่ formative_0=20 (ชิ้นที่ 2 / กลางภาค / ปลายภาค ว่าง) → รวม 20 = เกรด 0
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR, PHYSICS, M6_STUDENTS } = require('./helpers/fixtures');
const { computeGrade } = require('../functions/finalGrades');

const SUB = PHYSICS.code;
const CLS = PHYSICS.className;

// รูปของ seed: formative_0=20 + remark '-' ทุกคน · ไม่มี grade_summary
// ไฟล์เทสก่อนหน้า (scores.test.js) ทิ้ง remark/คะแนนค้างได้ จึงตั้งเองทั้งก่อนและหลัง
async function resetSubject() {
  await query(`DELETE FROM grade_summary WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  await query(`DELETE FROM score_database WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  for (const id of M6_STUDENTS) {
    for (const [ind, score] of [['formative_0', '20'], ['remark', '-']]) {
      await query(
        `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [`${id}_${SUB}_${ind}_${TERM}_${YEAR}`, id, SUB, ind, score, TERM, YEAR]);
    }
  }
}

before(resetSubject);
after(async () => { await resetSubject(); await stop(); });

// ── สูตร (ตรงกับ calcRow) ─────────────────────────────────────────────────

test('ช่องว่างนับเป็น 0 และนับจำนวนช่องว่างไว้', () => {
  const r = computeGrade(2, { formative_0: '20' });
  assert.equal(r.total, 20);
  assert.equal(r.grade, '0');
  assert.equal(r.blanks, 1);
});

test('ซ่อมกลางภาคใช้แทนกลางภาค', () => {
  const r = computeGrade(1, { formative_0: '40', midterm: '5', midterm_re: '15', final: '20' });
  assert.equal(r.total, 75);
  assert.equal(r.grade, '3.5');
});

test('remark ร/มส ชนะคะแนนรวม', () => {
  assert.equal(computeGrade(1, { formative_0: '50', final: '40', remark: 'ร' }).grade, 'ร');
  assert.equal(computeGrade(1, { formative_0: '50', final: '40', remark: '-' }).grade, '4');
});

// ── ผ่าน HTTP ─────────────────────────────────────────────────────────────

test('preview บอกยอดที่จะเกิดขึ้นโดยยังไม่เขียน', async () => {
  const res = await ok('getFinalGradePreview', ['teacher1', TERM, YEAR], 'teacher1');
  const p = res.pairs.find(x => x.subjectCode === SUB && x.className === CLS);
  assert.ok(p, 'ต้องมี ว30205 ม.6/1');
  assert.equal(p.students, M6_STUDENTS.length);
  assert.equal(p.zero, M6_STUDENTS.length);
  assert.equal(p.blanks, M6_STUDENTS.length);
  const { rows } = await query(`SELECT 1 FROM grade_summary WHERE subject_code=$1`, [SUB]);
  assert.equal(rows.length, 0, 'preview ห้ามเขียน');
});

test('กดสรุปแล้ว เด็กที่มีช่องว่างขึ้นติด 0 บนการ์ดทุกคน — ไม่ใช่แค่คนที่กรอกครบ', async () => {
  // แถว auto ต้องไม่ถูกแตะ
  await query(
    `INSERT INTO grade_summary(student_id,subject_code,grade,remedial_status,attendance_percent,term,year,ms_source)
     VALUES('01903',$1,'มส','มส',70,$2,$3,'auto')`, [SUB, TERM, YEAR]);

  const res = await ok('finalizeGrades', [SUB, CLS, TERM, YEAR], 'teacher1');
  assert.equal(res.zero, M6_STUDENTS.length - 1);

  const risk = await ok('getTeacherRiskDashboard', ['teacher1', TERM, YEAR], 'teacher1');
  const zeros = risk.details.filter(d => d.subjectCode === SUB && d.type === '0');
  assert.equal(zeros.length, M6_STUDENTS.length - 1);
  const ms = risk.details.find(d => d.subjectCode === SUB && d.type === 'มส');
  assert.equal(ms && ms.auto, true, 'มส. อัตโนมัติต้องคงอยู่');
});

test('กดซ้ำได้ — เกรดเดิมที่ผิดถูกคิดใหม่จากคะแนนปัจจุบัน', async () => {
  await query(
    `UPDATE grade_summary SET grade='0', total_score=5
     WHERE student_id='01901' AND subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  await query(
    `UPDATE score_database SET score='25' WHERE student_id='01901' AND subject_code=$1
       AND indicator_id='formative_0' AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  await query(
    `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
     VALUES($1,'01901',$2,'final','30',$3,$4)`, [`01901_${SUB}_final_${TERM}_${YEAR}`, SUB, TERM, YEAR]);
  try {
    await ok('finalizeGrades', [SUB, CLS, TERM, YEAR], 'teacher1');
    const { rows } = await query(
      `SELECT grade, total_score FROM grade_summary WHERE student_id='01901' AND subject_code=$1`, [SUB]);
    assert.equal(Number(rows[0].total_score), 55);
    assert.equal(rows[0].grade, '1.5');
  } finally {
    await query(`DELETE FROM score_database WHERE uid=$1`, [`01901_${SUB}_final_${TERM}_${YEAR}`]);
    await query(
      `UPDATE score_database SET score='20' WHERE student_id='01901' AND subject_code=$1
         AND indicator_id='formative_0' AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  }
});

test('autosave ของ ปพ.5 ต้องไม่ลบเกรดที่ครูกดสรุปไว้ แม้คะแนนยังมีช่องว่าง', async () => {
  await ok('finalizeGrades', [SUB, CLS, TERM, YEAR], 'teacher1');
  // payload แบบที่ calcRow ส่งมาทุก 3 วินาที — ทั้งห้อง ช่องว่างยังว่าง
  await ok('saveAllInOneWithConfig', [{
    subjectCode: SUB, className: CLS, term: TERM, year: YEAR,
    newConfig: { formative: 50, midterm: 20, final: 30,
      indicators: [{ name: 'ชิ้นงานที่ 1', score: 25 }, { name: 'ชิ้นงานที่ 2', score: 25 }] },
    scoreRecords: M6_STUDENTS.map(id => ({ studentId: id, indicatorId: 'formative_0', score: '20' })),
    gradeRecords: M6_STUDENTS.map(id => ({ studentId: id, subjectCode: SUB, totalScore: 20, grade: '0', remark: '' })),
  }], 'teacher1');
  const { rows } = await query(
    `SELECT student_id, ms_source FROM grade_summary WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [SUB, TERM, YEAR]);
  assert.equal(rows.length, M6_STUDENTS.length, 'แถวที่สรุปแล้วต้องอยู่ครบ');
  assert.ok(rows.filter(r => r.ms_source === 'final').length >= M6_STUDENTS.length - 1);
});

test('ครูที่ไม่ได้สอนวิชานั้นกดสรุปไม่ได้', async () => {
  await denied('finalizeGrades', [SUB, CLS, TERM, YEAR], 'teacher2');
});

test('นักเรียนเรียกไม่ได้ทั้งสองตัว', async () => {
  await denied('getFinalGradePreview', ['teacher1', TERM, YEAR], 'student');
  await denied('finalizeGrades', [SUB, CLS, TERM, YEAR], 'student');
});

test('preview ของครูใช้ id จาก JWT ไม่ใช่ที่ส่งมา', async () => {
  const res = await ok('getFinalGradePreview', ['teacher1', TERM, YEAR], 'teacher2');
  assert.equal(res.pairs.some(p => p.subjectCode === SUB), false);
});
