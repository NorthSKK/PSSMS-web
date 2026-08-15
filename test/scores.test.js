/**
 * ครอบบั๊กที่เคยหลุดจริงในระบบคะแนน ปพ.5 (ดู CLAUDE.md — Score Conventions)
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR, PHYSICS } = require('./helpers/fixtures');

after(stop);

const SUB = PHYSICS.code;
const STD = '01901';

const readScore = async (indicatorId, studentId = STD) => {
  const { rows } = await query(
    `SELECT score FROM score_database
      WHERE student_id=$1 AND subject_code=$2 AND indicator_id=$3 AND term=$4 AND year=$5`,
    [studentId, SUB, indicatorId, TERM, YEAR]
  );
  return rows.length ? rows[0].score : null;
};

const readGrade = async (studentId = STD) => {
  const { rows } = await query(
    `SELECT total_score, grade FROM grade_summary
      WHERE student_id=$1 AND subject_code=$2 AND term=$3 AND year=$4`,
    [studentId, SUB, TERM, YEAR]
  );
  return rows[0] || null;
};

const saveScores = (rows) => ok('saveAllInOneScores', [rows, SUB, TERM, YEAR], 'teacher1');

// config ที่ seed ใส่ไว้: ratio 50:20:30, formative 2 ตัว
const CONFIG = {
  formative: 50, midterm: 20, final: 30,
  indicators: [
    { code: '', name: 'ชิ้นงานที่ 1', score: 25, description: '' },
    { code: '', name: 'ชิ้นงานที่ 2', score: 25, description: '' },
  ],
};

const saveAll = (scoreRecords, gradeRecords) => ok('saveAllInOneWithConfig', [{
  subjectCode: SUB, className: PHYSICS.className, term: TERM, year: YEAR,
  newConfig: CONFIG, scoreRecords, gradeRecords,
}], 'teacher1');

test('เขียนคะแนนแล้วอ่านกลับได้', async () => {
  await saveScores([{ studentId: STD, indicatorId: 'formative_1', score: '18' }]);
  assert.equal(await readScore('formative_1'), '18');
});

test('ล้างช่องคะแนน = ลบแถวทิ้ง ไม่ใช่ค้างค่าเดิม', async () => {
  await saveScores([{ studentId: STD, indicatorId: 'formative_1', score: '18' }]);
  await saveScores([{ studentId: STD, indicatorId: 'formative_1', score: '' }]);
  assert.equal(await readScore('formative_1'), null);
});

test('remark เก็บเป็น TEXT ได้ (ร / มส / -)', async () => {
  await saveScores([{ studentId: STD, indicatorId: 'remark', score: 'มส' }]);
  assert.equal(await readScore('remark'), 'มส');
  await saveScores([{ studentId: STD, indicatorId: 'remark', score: '-' }]);
  assert.equal(await readScore('remark'), '-');
});

test('completeness gate: กรอกไม่ครบ → ไม่เขียน grade_summary', async () => {
  await saveAll(
    [
      { studentId: STD, indicatorId: 'formative_0', score: '20' },
      { studentId: STD, indicatorId: 'formative_1', score: '' },
      { studentId: STD, indicatorId: 'midterm', score: '' },
      { studentId: STD, indicatorId: 'final', score: '' },
      { studentId: STD, indicatorId: 'remark', score: '-' },
    ],
    [{ studentId: STD, totalScore: 20, grade: '0', remark: '' }]
  );
  assert.equal(await readGrade(), null);
});

test('completeness gate: กรอกครบ → เขียน grade_summary', async () => {
  await saveAll(
    [
      { studentId: STD, indicatorId: 'formative_0', score: '25' },
      { studentId: STD, indicatorId: 'formative_1', score: '20' },
      { studentId: STD, indicatorId: 'midterm', score: '18' },
      { studentId: STD, indicatorId: 'final', score: '25' },
      { studentId: STD, indicatorId: 'remark', score: '-' },
    ],
    [{ studentId: STD, totalScore: 88, grade: '4', remark: '' }]
  );
  const g = await readGrade();
  assert.equal(g.grade, '4');
  assert.equal(Number(g.total_score), 88);
});

test('remark มส bypass gate แล้วยกเลิกกลับเป็น - ต้องลบแถวเก่าทิ้ง', async () => {
  const scores = (remark) => [
    { studentId: STD, indicatorId: 'formative_0', score: '' },
    { studentId: STD, indicatorId: 'formative_1', score: '' },
    { studentId: STD, indicatorId: 'midterm', score: '' },
    { studentId: STD, indicatorId: 'final', score: '' },
    { studentId: STD, indicatorId: 'remark', score: remark },
  ];
  await saveAll(scores('มส'), [{ studentId: STD, totalScore: 0, grade: 'มส', remark: 'มส' }]);
  assert.equal((await readGrade()).grade, 'มส');

  // ครูปลดธง — การ์ด "นักเรียนกลุ่มเสี่ยง" ต้องไม่รายงานเด็กคนนี้อีก
  await saveAll(scores('-'), [{ studentId: STD, totalScore: 0, grade: '0', remark: '' }]);
  assert.equal(await readGrade(), null);
});

test('รหัสนักเรียนที่มี 0 นำหน้าไม่ถูกตัดทิ้งตอนบันทึก', async () => {
  await saveScores([{ studentId: '01903', indicatorId: 'formative_0', score: '15' }]);
  assert.equal(await readScore('formative_0', '01903'), '15');
  assert.equal(await readScore('formative_0', '1903'), null);
});

// สัญญาของ grid: รายชื่อนักเรียนเป็น id ดิบ (มี 0 นำหน้า) แต่ existingScores key
// ด้วย normID เพราะ frontend เอาไปทำ DOM element id — ปนกันเมื่อไหร่ lookup ไม่เจอเงียบ ๆ
test('getAllInOneScoreGridData: students = id ดิบ, existingScores = normID', async () => {
  await saveScores([{ studentId: '01903', indicatorId: 'formative_0', score: '15' }]);
  const grid = await ok('getAllInOneScoreGridData', [SUB, PHYSICS.className, TERM, YEAR], 'teacher1');

  const ids = (grid.students || []).map(row => String(row[0]));
  assert.ok(ids.includes('01903'), `expected raw id in ${JSON.stringify(ids)}`);

  assert.equal(grid.existingScores['1903_formative_0'], '15');
  assert.equal(grid.existingScores['01903_formative_0'], undefined);
});
