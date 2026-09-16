'use strict';
/**
 * มส. อัตโนมัติจากเวลาเรียน — `grade_summary.ms_source = 'auto'`
 *
 * ปัญหาที่แก้: การ์ด "นักเรียนกลุ่มเสี่ยง (0, ร, มส.)" อ่านจาก `grade_summary`
 * ซึ่งมีแถวก็ต่อเมื่อครูเปิดหน้า ปพ.5 แล้วกดบันทึก ส่วนการ์ด "กระดานแจ้งเตือน
 * กลุ่มเสี่ยง" คำนวณสดจากเวลาเรียน สองการ์ดจึงไม่ตรงกันตลอดเทอม
 * หน้า ปพ.5 เติม `มส` ให้ช่อง remark อยู่แล้วเมื่อ %<80 (`autoMS` ใน
 * `src/Scripts_Score.html`) แต่ค่านั้นอยู่แค่ใน DOM จนกว่าครูจะกดบันทึก
 *
 * กติกา (เรียงตามลำดับที่ชนะกัน):
 *   1. ครูชนะเสมอ — มี remark ที่ครูตั้งเองใน `score_database`
 *      (`indicator_id='remark'` ค่าไม่ใช่ `''`/`'-'`) หรือมีแถว `grade_summary`
 *      ที่ `ms_source` ไม่ใช่ `'auto'` → ระบบไม่แตะทั้งเขียนและลบ
 *   2. เวลาเรียน < 80% → เขียน/คงแถว `มส` ที่ `ms_source='auto'`
 *   3. เวลาเรียน ≥ 80% และแถวเดิมเป็นของระบบ → **DELETE ทิ้ง** ไม่ใช่ปล่อยค้าง
 *      (เหตุผลเดียวกับ completeness gate — แถวค้างทำให้การ์ดรายงานเด็กที่พ้นเกณฑ์ไปแล้ว)
 *
 * ⚠️ **สูตร % ต้องมาจาก `getSemesterReport` เท่านั้น ห้ามเขียนใหม่ที่นี่**
 * (`totalCoursePeriods = periodsPerWeek × 20`, `totalMissed = absent + leave`)
 * เขียนซ้ำเมื่อไหร่ ตัวเลขบนการ์ดกับตัวเลขบนหน้ารายงานจะ drift โดยไม่มีอะไรฟ้อง
 *
 * ⚠️ **รหัสนักเรียนใช้ id ดิบเสมอ** (`'01903'` ไม่ใช่ `'1903'`) — `getSemesterReport`
 * คืน `s.id` ดิบ ส่วน `attStats` ใน `functions/scores.js` key ด้วย `normID()`
 * ผสมสองแบบเมื่อไหร่ lookup ไม่เจอแล้วพังเงียบ (เคยหลุดมาแล้ว 2 ครั้ง)
 */
const { query } = require('../lib/db');
const { getSemesterReport } = require('./attendanceReport');
const { subjectPrefixOf, isHomeroomManagedSubject } = require('../lib/subjectGroup');

const AUTO_SOURCE = 'auto';
const MS_GRADE = 'มส';
// เกณฑ์เดียวกับ bucket 'ms' ของ getTeacherAtRiskDashboard และ autoMS ฝั่งหน้า ปพ.5
const MS_PERCENT_THRESHOLD = 80;

const sid = (v) => String(v === undefined || v === null ? '' : v).trim();

/**
 * โฮมรูม (`HR`), แนะแนว/วิถีพุทธ (`-`) และชุมนุม (`CLUB_*`) ไม่มีเกรดรายวิชา
 * — `subjectPrefixOf()` คืน `''` ให้ทั้งสามแบบ
 */
function isGradedSubject(subjectCode) {
  if (isHomeroomManagedSubject(subjectCode)) return false;
  return subjectPrefixOf(subjectCode) !== '';
}

/**
 * อ่านอย่างเดียว — คืนว่าจะเขียน/ถอนใครบ้าง โดยยังไม่แตะ DB
 * ใช้ร่วมกันระหว่าง hook ตอนเช็คชื่อ (ผ่าน syncAutoMs) กับ dry-run ของ
 * `db/backfill-auto-ms.js` — สูตรจึงอยู่ที่เดียว
 *
 * @returns {{eligible:boolean, subjectCode:string, className:string, term:string,
 *            year:string, toWrite:{studentId:string,percent:number}[], toRemove:string[]}}
 */
async function planAutoMs({ subjectCode, className, term, year }) {
  const code = sid(subjectCode);
  const cls = sid(className);
  const t = sid(term);
  const y = sid(year);
  const empty = { eligible: false, subjectCode: code, className: cls, term: t, year: y, toWrite: [], toRemove: [] };
  if (!code || !cls || !t || !y) return empty;
  if (!isGradedSubject(code)) return empty;

  const report = await getSemesterReport([code, cls, t, y]);
  const students = (report && report.students) || [];
  if (!students.length) return { ...empty, eligible: true };

  const [remarkRes, gradeRes] = await Promise.all([
    query(
      `SELECT student_id, score FROM score_database
        WHERE subject_code=$1 AND term=$2 AND year=$3 AND indicator_id='remark'`,
      [code, t, y]
    ),
    query(
      `SELECT student_id, ms_source FROM grade_summary
        WHERE subject_code=$1 AND term=$2 AND year=$3`,
      [code, t, y]
    ),
  ]);

  // remark ที่ครูตั้งเอง — `'-'` แปลว่า "ไม่มี" ไม่ใช่การตัดสิน จึงไม่นับ
  const teacherRemark = new Set(
    remarkRes.rows
      .filter(r => { const v = sid(r.score); return v !== '' && v !== '-'; })
      .map(r => sid(r.student_id))
  );
  const existingSource = new Map(gradeRes.rows.map(r => [sid(r.student_id), sid(r.ms_source)]));

  const toWrite = [];
  const toRemove = [];
  for (const s of students) {
    const id = sid(s.id);
    if (!id) continue;
    if (teacherRemark.has(id)) continue;
    // มีแถวอยู่แล้วแต่ไม่ใช่ของระบบ = ครูเขียนไว้ ห้ามแตะ
    if (existingSource.has(id) && existingSource.get(id) !== AUTO_SOURCE) continue;

    const pct = parseFloat(s.percent);
    if (!isFinite(pct)) continue;
    if (pct < MS_PERCENT_THRESHOLD) toWrite.push({ studentId: id, percent: Math.round(pct * 100) / 100 });
    else if (existingSource.get(id) === AUTO_SOURCE) toRemove.push(id);
  }

  return { eligible: true, subjectCode: code, className: cls, term: t, year: y, toWrite, toRemove };
}

/**
 * ทบทวน มส. อัตโนมัติของ 1 วิชา × 1 ห้อง แล้วเขียนผลลง `grade_summary`
 * เรียกหลังเช็คชื่อสำเร็จ (`saveAttendanceBatch` / `saveMassiveAttendanceGrid`)
 * และจาก `db/backfill-auto-ms.js --apply`
 *
 * @returns {{eligible:boolean, written:number, removed:number}}
 */
async function syncAutoMs(target) {
  const plan = await planAutoMs(target);
  if (!plan.eligible) return { eligible: false, written: 0, removed: 0 };

  let written = 0;
  let removed = 0;

  if (plan.toWrite.length) {
    const n = plan.toWrite.length;
    // `WHERE grade_summary.ms_source=$8` บน DO UPDATE เป็นด่านสุดท้ายฝั่ง DB:
    // ต่อให้ครูเพิ่งกดบันทึก ปพ.5 คั่นระหว่าง plan กับ apply แถวของครูก็ไม่ถูกทับ
    // (rowCount ที่หายไปจึงไม่ใช่ความผิดพลาด ไม่ต้อง throw)
    const res = await query(
      `INSERT INTO grade_summary(student_id,subject_code,grade,remedial_status,attendance_percent,term,year,ms_source)
       SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::numeric[],$6::text[],$7::text[],$8::text[])
         AS v(student_id,subject_code,grade,remedial_status,attendance_percent,term,year,ms_source)
       ON CONFLICT(student_id,subject_code,term,year) DO UPDATE
         SET grade=EXCLUDED.grade,
             remedial_status=EXCLUDED.remedial_status,
             attendance_percent=EXCLUDED.attendance_percent,
             ms_source=EXCLUDED.ms_source
         WHERE grade_summary.ms_source=$9`,
      [
        plan.toWrite.map(r => r.studentId),
        Array(n).fill(plan.subjectCode),
        Array(n).fill(MS_GRADE),
        Array(n).fill(MS_GRADE),
        plan.toWrite.map(r => r.percent),
        Array(n).fill(plan.term),
        Array(n).fill(plan.year),
        Array(n).fill(AUTO_SOURCE),
        AUTO_SOURCE,
      ]
    );
    written = res.rowCount || 0;
  }

  if (plan.toRemove.length) {
    const res = await query(
      `DELETE FROM grade_summary
        WHERE subject_code=$1 AND term=$2 AND year=$3 AND ms_source=$4
          AND student_id = ANY($5::text[])`,
      [plan.subjectCode, plan.term, plan.year, AUTO_SOURCE, plan.toRemove]
    );
    removed = res.rowCount || 0;
  }

  return { eligible: true, written, removed };
}

module.exports = {
  planAutoMs,
  syncAutoMs,
  isGradedSubject,
  AUTO_SOURCE,
  MS_GRADE,
  MS_PERCENT_THRESHOLD,
};
