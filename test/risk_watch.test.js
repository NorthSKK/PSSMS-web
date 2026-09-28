/**
 * การ์ดนักเรียนกลุ่มเสี่ยง — ป้ายเฝ้าระวังกลางเทอม (functions/riskWatch.js)
 *
 * grade_summary เก็บเฉพาะเกรดที่ตัดสินแล้ว กลางเทอมจึงว่างโดยออกแบบ ป้ายเฝ้าระวัง
 * คำนวณสดจากคะแนนที่มีอยู่ + เวลาเรียน โดยไม่เขียนอะไรลง DB
 *
 * ⚠️ ตั้งคะแนนของ ว30205 กลับเป็นรูปของ seed ทั้งใน before() และ after() —
 * ไฟล์เทสที่รันก่อนหน้าทิ้งคะแนนค้างไว้ได้ และไฟล์หลังจากนี้ก็พึ่งแถวชุดนี้
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR, PHYSICS, M6_STUDENTS } = require('./helpers/fixtures');
const { evaluateClass, componentsOf } = require('../functions/riskWatch');

const SUB = PHYSICS.code;
const CLS = PHYSICS.className;
const SESSION_TAG = 'riskwatch-test';

async function setScore(studentId, indicatorId, score) {
  await query(
    `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (student_id, subject_code, indicator_id, term, year) DO UPDATE SET score=EXCLUDED.score`,
    [`${studentId}_${SUB}_${indicatorId}_${TERM}_${YEAR}`, studentId, SUB, indicatorId, score, TERM, YEAR]
  );
}

// รูปของ seed: formative_0=20 + remark '-' ทุกคน ไม่มีอย่างอื่น · ไม่มี grade_summary
async function resetScores() {
  await query(
    `DELETE FROM score_database WHERE subject_code=$1 AND term=$2 AND year=$3
       AND indicator_id NOT IN ('formative_0','remark')`, [SUB, TERM, YEAR]);
  for (const id of M6_STUDENTS) {
    await setScore(id, 'formative_0', '20');
    await setScore(id, 'remark', '-');
  }
  await query(`DELETE FROM grade_summary WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
}

// เช็คชื่อ ว30205 ตั้งเป็นรูปของ seed (2 คาบ · 01903 ขาดทั้งคู่ คนอื่นมา) แล้วคืนของเดิมตอนจบ
// ไฟล์เทสก่อนหน้าทิ้งคาบค้างไว้ได้ ตัวหาร "คาบที่สอนไปแล้ว" จะเพี้ยน
let _attBackup = [];
const ATT_COLS = 'date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id';
async function insertAtt(r) {
  await query(
    `INSERT INTO attendance(${ATT_COLS}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [r.date, r.term, r.year, r.subject_code, r.subject_name, r.class, r.period,
     r.student_id, r.student_name, r.status, r.session_id, r.teacher_id]);
}

before(async () => {
  await resetScores();
  const { rows } = await query(
    `SELECT to_char(date,'YYYY-MM-DD') AS date, term, year, subject_code, subject_name, class, period,
            student_id, student_name, status, session_id, teacher_id
       FROM attendance WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  _attBackup = rows;
  await query(`DELETE FROM attendance WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  for (const date of ['2026-05-13', '2026-05-14']) {
    for (const id of M6_STUDENTS) {
      await insertAtt({ date, term: TERM, year: YEAR, subject_code: SUB, subject_name: PHYSICS.name,
        class: CLS, period: '1', student_id: id, student_name: 'ทดสอบ',
        status: id === '01903' ? 'ขาด' : 'มา', session_id: `${SESSION_TAG}-${date}`, teacher_id: 'teacher1' });
    }
  }
});

after(async () => {
  await resetScores();
  await query(`DELETE FROM attendance WHERE subject_code=$1 AND term=$2 AND year=$3`, [SUB, TERM, YEAR]);
  for (const r of _attBackup) await insertAtt(r);
  await stop();
});

const watchOf = async (who, asId = 'teacher1') => {
  const b = await ok('getTeacherDashboardBundle', [asId, TERM, YEAR], who);
  assert.equal(b.riskWatch.ok, true, b.riskWatch.error);
  return b.riskWatch.data;
};
const itemOf = (data, id) => data.items.find(i => i.subjectCode === SUB && i.studentId === id);

// ── กติกาล้วน (ไม่แตะ DB) ─────────────────────────────────────────────────

const CFG = {
  score_ratio: '50:20:30',
  indicators_json: [{ name: 'งาน 1', score: 25 }, { name: 'งาน 2', score: 25 }],
};
const ROSTER = [{ id: '01901', name: 'ก' }, { id: '01902', name: 'ข' }];

test('ชิ้นที่ยังไม่มีใครในห้องได้คะแนน ไม่นับเป็นขาดงาน', () => {
  const out = evaluateClass(componentsOf(CFG), ROSTER, {
    '1901': { formative_0: '20' }, '1902': { formative_0: '20' },
  });
  assert.deepEqual(out.map(r => r.missing), [[], []]);
});

test('มีคะแนนแม้แต่คนเดียว ช่องว่างของคนอื่นนับเป็นขาดงาน', () => {
  const out = evaluateClass(componentsOf(CFG), ROSTER, {
    '1901': { formative_0: '20', formative_1: '20' }, '1902': { formative_0: '20' },
  });
  assert.deepEqual(out[1].missing, ['งาน 2']);
});

test('% คะแนนเก็บคิดเฉพาะชิ้นที่นักเรียนคนนั้นมีคะแนน — ช่องว่างไม่ถูกนับเป็น 0', () => {
  const out = evaluateClass(componentsOf(CFG), ROSTER, {
    '1901': { formative_0: '10', formative_1: '20' }, '1902': { formative_0: '10' },
  });
  assert.equal(out[0].scorePct, 60);   // 30 / 50
  assert.equal(out[1].scorePct, 40);   // 10 / 25 — งาน 2 ไปอยู่ที่ missing แทน
});

test('ซ่อมกลางภาคนับเป็นมีคะแนนกลางภาค และใช้แทนค่าเดิม', () => {
  const out = evaluateClass(componentsOf(CFG), ROSTER, {
    '1901': { midterm: '5', midterm_re: '15' }, '1902': { midterm_re: '4' },
  });
  assert.deepEqual(out.map(r => r.missing), [[], []]);
  assert.equal(out[0].scorePct, 75);   // 15 / 20
});

// ── ผ่าน HTTP + DB ────────────────────────────────────────────────────────

test('seed: ทุกคนได้ 20/25 และยังไม่มีใครได้ชิ้นที่ 2 → ไม่มีป้ายคะแนน', async () => {
  const data = await watchOf('teacher1');
  const scoreChips = data.items.filter(i => i.subjectCode === SUB && (i.missing.length || i.scorePct !== null));
  assert.equal(scoreChips.length, 0);
});

test('เวลาเรียนคิดจากคาบที่สอนไปแล้ว — ขาด 2 จาก 2 คาบ = 0% แม้ % ทางการยัง ~97', async () => {
  // seed: 01903 ขาดทั้ง 2 คาบที่เช็คไว้ · ทางการ (60 − 2) / 60 = 96.67% ซึ่งไม่ถึงเกณฑ์ 85
  const it = itemOf(await watchOf('teacher1'), '01903');
  assert.ok(it, '01903 ต้องขึ้นป้ายเวลาเรียน');
  assert.equal(it.attendancePct, 0);
  assert.equal(it.attendanceMissed, 2);
  assert.equal(it.attendanceTaught, 2);
});

test('ขาดงาน / คะแนนเก็บต่ำ ขึ้นป้าย และเกรดที่ตัดสินแล้วไม่มีป้ายซ้อน', async () => {
  await setScore('01901', 'formative_1', '20');
  await setScore('01902', 'formative_0', '10');                // 10/25 = 40%
  await setScore('01904', 'remark', 'ร');                      // ครูตัดสินแล้ว
  await query(
    `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,term,year)
     VALUES('01903',$1,40,'0',$2,$3)`, [SUB, TERM, YEAR]);    // เกรดตัดสินแล้ว

  const data = await watchOf('teacher1');
  const s2 = itemOf(data, '01902');
  assert.ok(s2, '01902 ต้องขึ้นป้าย');
  assert.deepEqual(s2.missing, ['ชิ้นงานที่ 2']);
  assert.equal(s2.scorePct, 40);
  assert.equal(s2.className, CLS);

  assert.equal(itemOf(data, '01901'), undefined, 'ส่งครบ คะแนนดี ไม่ต้องขึ้น');
  assert.equal(itemOf(data, '01903'), undefined, 'ติด 0 แล้ว การ์ดโชว์อยู่แล้ว');
  assert.equal(itemOf(data, '01904'), undefined, 'ครูตั้ง remark แล้ว');
  assert.equal(data.summary.r >= 1 && data.summary.zero >= 1, true);
});

test('เกรดผ่านแล้ว (เช่นหลังกดสรุปเกรด) ป้ายเฝ้าระวังยังอยู่ — ซ่อนเฉพาะคนที่ติด 0/ร/มส', async () => {
  // 01902 ขาดชิ้นที่ 2 แต่มีแถวเกรด 1 จากการกดสรุปเกรด → ยังต้องเห็นว่าขาดงาน
  await query(
    `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,term,year,ms_source)
     VALUES('01902',$1,50,'1',$2,$3,'final')`, [SUB, TERM, YEAR]);
  try {
    const s2 = itemOf(await watchOf('teacher1'), '01902');
    assert.ok(s2, 'เกรด 1 ต้องไม่ทำให้ป้ายเฝ้าระวังหาย');
    assert.deepEqual(s2.missing, ['ชิ้นงานที่ 2']);
  } finally {
    await query(`DELETE FROM grade_summary WHERE student_id='01902' AND subject_code=$1`, [SUB]);
  }
});

test('เวลาเรียน ≤ 85% ขึ้นป้ายเฝ้าระวัง มส.', async () => {
  // ว30205 = 3 คาบ/สัปดาห์ → 60 คาบทั้งเทอม · ขาด 9 = 85.00%
  // นับที่ขาด/ลา/โดดค้างอยู่แล้วด้วย (seed + ไฟล์เทสก่อนหน้า) แล้วเติมให้ครบ 9
  const { rows: [{ n }] } = await query(
    `SELECT COUNT(*)::int AS n FROM attendance
     WHERE subject_code=$1 AND term=$2 AND year=$3 AND student_id='01901' AND status IN ('ขาด','ลา','โดด')`,
    [SUB, TERM, YEAR]);
  for (let i = 1; i <= 9 - n; i++) {
    const date = `2026-06-${String(i).padStart(2, '0')}`;
    await query(
      `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,'1','01901','ทดสอบ','ขาด',$7,'teacher1')`,
      [date, TERM, YEAR, SUB, PHYSICS.name, CLS, `${SESSION_TAG}-${date}`]
    );
  }
  const it = itemOf(await watchOf('teacher1'), '01901');
  assert.ok(it, '01901 ต้องขึ้นป้ายเวลาเรียน');
  // ป้ายแสดง % จากคาบที่สอนไปแล้ว ไม่ใช่ 85% ของทั้งเทอม
  assert.equal(it.attendanceMissed, 9);
  assert.ok(it.attendanceTaught >= 9);
  const expected = Math.round(((it.attendanceTaught - 9) / it.attendanceTaught) * 10000) / 100;
  assert.equal(it.attendancePct, expected);
  assert.ok(it.attendancePct < 85, 'กลางเทอมต้องต่ำกว่า % ทางการ');
});

test('ครูส่ง teacherId ของคนอื่นมา ได้ป้ายของตัวเองเท่านั้น', async () => {
  const data = await watchOf('teacher2', 'teacher1');
  assert.equal(data.items.filter(i => i.subjectCode === SUB).length, 0);
});

test('Admin ดูของครูคนอื่นได้', async () => {
  const data = await watchOf('admin', 'teacher1');
  assert.ok(itemOf(data, '01902'));
});
