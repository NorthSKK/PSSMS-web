const { query } = require('../lib/db');
const { verifyTeacherOwnsSubject, isManagement } = require('../lib/permissions');
const { isGradedSubject, AUTO_SOURCE } = require('./autoMs');

// ============================================================
// สรุปเกรดส่งรายงาน — ปุ่มบนการ์ด "นักเรียนกลุ่มเสี่ยง (0, ร, มส.)"
//
// autosave ของ ปพ.5 เขียน grade_summary เฉพาะเด็กที่กรอกคะแนนครบทุกช่อง
// (completeness gate ใน functions/scores.js) เพราะกลางเทอมช่องว่าง = "ยังไม่ได้กรอก"
// ท้ายเทอมช่องว่างแปลว่า "ไม่ส่งงาน/ไม่มาสอบ" = 0 แต่ระบบแยกสองอย่างนี้เองไม่ได้
// ครูจึงต้องเป็นคนกดยืนยัน — ปุ่มนี้คือการปลด gate ทีละ วิชา×ห้อง
//
// คิดใหม่ทั้งห้องจาก score_database ด้วยสูตรเดียวกับ calcRow() ใน
// src/Scripts_Score.html (ช่องว่าง = 0) ไม่รับเกรดจาก client
//
// ⚠️ ไม่แตะแถว ms_source='auto' — มส. จากเวลาเรียนเป็นกติกาของ functions/autoMs.js
// ครูที่ต้องการทับให้ตั้ง remark ในหน้า ปพ.5
//
// แถวที่สรุปแล้วติด ms_source='final' — autosave ของ ปพ.5 ลบแถวของเด็กที่กรอกไม่ครบ
// ทิ้งทุก 3 วินาที (completeness gate) ถ้าไม่มีป้ายนี้ ครูเปิด ปพ.5 แก้ช่องเดียว
// เกรด 0 ที่เพิ่งยืนยันจะหายทั้งห้อง · autosave ยังเขียนทับได้เมื่อเด็กกรอกครบ (ms_source=NULL)
// ============================================================

const FINAL_SOURCE = 'final';

const normalize = (s) => String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const num = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };

// ตรงกับ calculateGrade() ใน src/Scripts_Score.html
function calculateGrade(score) {
  if (score >= 80) return '4';
  if (score >= 75) return '3.5';
  if (score >= 70) return '3';
  if (score >= 65) return '2.5';
  if (score >= 60) return '2';
  if (score >= 55) return '1.5';
  if (score >= 50) return '1';
  return '0';
}

/**
 * Pure — ตรงกับ calcRow(): Σformative + (midterm_re ?? midterm) + final, ช่องว่าง = 0
 * scores: { indicator_id: score } ของนักเรียนหนึ่งคน
 */
function computeGrade(formativeCount, scores) {
  const remark = String(scores.remark || '').trim();
  let total = 0;
  let blanks = 0;
  for (let i = 0; i < formativeCount; i++) {
    const v = scores[`formative_${i}`];
    if (blank(v)) blanks++;
    total += num(v);
  }
  total += blank(scores.midterm_re) ? num(scores.midterm) : num(scores.midterm_re);
  total += num(scores.final);
  const grade = (remark === 'ร' || remark === 'มส') ? remark : calculateGrade(total);
  return { total, grade, remark: remark === 'ร' || remark === 'มส' ? remark : '', blanks };
}

/**
 * คำนวณผลของ วิชา×ห้อง หนึ่งคู่ โดยยังไม่เขียน
 * คืน { rows:[{studentId, stdName, total, grade, remark, blanks}], skippedAuto, noConfig }
 */
async function planClass(subjectCode, className, term, year) {
  const [cfgRes, rosterRes, scoreRes, gsRes] = await Promise.all([
    query(
      `SELECT class_name, indicators_json FROM subject_config
       WHERE subject_code=$1 AND term=$2 AND year=$3`,
      [subjectCode, term, year]
    ),
    query(
      `SELECT username, full_name, department FROM users
       WHERE UPPER(role)='STUDENT' AND status='ปกติ'`
    ),
    query(
      `SELECT student_id, indicator_id, score FROM score_database
       WHERE subject_code=$1 AND term=$2 AND year=$3`,
      [subjectCode, term, year]
    ),
    query(
      `SELECT student_id, ms_source FROM grade_summary
       WHERE subject_code=$1 AND term=$2 AND year=$3`,
      [subjectCode, term, year]
    ),
  ]);

  const cfg = cfgRes.rows.find(c => normalize(c.class_name) === normalize(className));
  if (!cfg) return { rows: [], skippedAuto: 0, noConfig: true };
  let indicators = [];
  try {
    indicators = typeof cfg.indicators_json === 'string' ? JSON.parse(cfg.indicators_json) : (cfg.indicators_json || []);
  } catch (e) { indicators = []; }
  const formativeCount = Array.isArray(indicators) ? indicators.length : 0;

  // key ด้วย id ดิบ — score_database และ users เก็บรูปเดียวกัน ('01903')
  const scores = {};
  for (const r of scoreRes.rows) {
    const k = String(r.student_id).trim();
    (scores[k] || (scores[k] = {}))[r.indicator_id] = r.score;
  }
  const auto = new Set(gsRes.rows
    .filter(r => r.ms_source === AUTO_SOURCE)
    .map(r => String(r.student_id).trim()));

  const roster = rosterRes.rows
    .filter(u => normalize(u.department) === normalize(className))
    .sort((a, b) => String(a.username).localeCompare(String(b.username)));

  const rows = [];
  let skippedAuto = 0;
  for (const u of roster) {
    const id = String(u.username).trim();
    if (auto.has(id)) { skippedAuto++; continue; }
    rows.push({ studentId: id, stdName: u.full_name || id, ...computeGrade(formativeCount, scores[id] || {}) });
  }
  return { rows, skippedAuto, noConfig: false };
}

const countGrades = (rows) => ({
  zero: rows.filter(r => r.grade === '0').length,
  r: rows.filter(r => r.grade === 'ร').length,
  ms: rows.filter(r => r.grade === 'มส').length,
  blanks: rows.filter(r => r.blanks > 0 && !r.remark).length,
});

// อ่านอย่างเดียว — หน้าต่างยืนยันก่อนกด แสดงทุก วิชา×ห้อง ที่ครูสอน พร้อมยอดที่จะเกิดขึ้น
// Frontend: .getFinalGradePreview(teacherId, term, year)
async function getFinalGradePreview([teacherId, term, year], user) {
  const tid = user && !isManagement(user) ? String(user.id) : String(teacherId || '').trim();
  const { rows } = await query(
    `SELECT DISTINCT subject_code, subject_name, level, room
     FROM timetable WHERE teacher_id=$1 AND term=$2 AND year=$3
     ORDER BY subject_code, level, room`,
    [tid, term, year]
  );
  const pairs = rows.filter(r => isGradedSubject(r.subject_code));
  const out = [];
  for (const p of pairs) {
    const className = `${String(p.level).trim()}/${String(p.room).trim()}`;
    const plan = await planClass(p.subject_code, className, term, year);
    out.push({
      subjectCode: p.subject_code, subjectName: p.subject_name || '', className,
      students: plan.rows.length, noConfig: plan.noConfig, skippedAuto: plan.skippedAuto,
      ...countGrades(plan.rows),
    });
  }
  return { status: 'success', pairs: out };
}

// เขียนจริง — ทีละ วิชา×ห้อง
// Frontend: .finalizeGrades(subjectCode, className, term, year)
async function finalizeGrades([subjectCode, className, term, year], user) {
  if (!subjectCode || !className || !term || !year) throw new Error('ข้อมูลวิชา/ห้อง/ภาคเรียนไม่ครบ');
  if (!isGradedSubject(subjectCode)) throw new Error('วิชานี้ไม่มีเกรดรายวิชา');
  await verifyTeacherOwnsSubject(user, subjectCode, className, term, year);

  const plan = await planClass(subjectCode, className, term, year);
  if (plan.noConfig) throw new Error(`ยังไม่ได้ตั้งค่าโครงสร้างวิชา ${subjectCode} ห้อง ${className} ในหน้า ปพ.5`);
  if (!plan.rows.length) throw new Error(`ไม่พบนักเรียนในห้อง ${className}`);

  const n = plan.rows.length;
  // WHERE กันแถว auto ที่เพิ่งเกิดระหว่าง plan กับ write
  await query(
    `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,remedial_status,term,year,ms_source)
     SELECT v.*, $9::text FROM unnest($1::text[],$2::text[],$3::numeric[],$4::text[],$5::text[],$6::text[],$7::text[])
       AS v(student_id,subject_code,total_score,grade,remedial_status,term,year)
     ON CONFLICT(student_id,subject_code,term,year) DO UPDATE
       SET total_score=EXCLUDED.total_score,
           grade=EXCLUDED.grade,
           remedial_status=EXCLUDED.remedial_status,
           ms_source=EXCLUDED.ms_source
       WHERE grade_summary.ms_source IS DISTINCT FROM $8`,
    [
      plan.rows.map(r => r.studentId),
      Array(n).fill(subjectCode),
      plan.rows.map(r => r.total),
      plan.rows.map(r => r.grade),
      plan.rows.map(r => r.remark),
      Array(n).fill(String(term)),
      Array(n).fill(String(year)),
      AUTO_SOURCE,
      FINAL_SOURCE,
    ]
  );

  const c = countGrades(plan.rows);
  return {
    status: 'success',
    message: `สรุปเกรด ${subjectCode} ห้อง ${className} แล้ว ${n} คน (ติด 0: ${c.zero} · ร: ${c.r} · มส: ${c.ms})`,
    ...c, students: n,
  };
}

module.exports = {
  getFinalGradePreview,
  finalizeGrades,
  computeGrade,
  calculateGrade,
  FINAL_SOURCE,
};
