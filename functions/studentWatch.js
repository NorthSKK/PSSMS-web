'use strict';
/**
 * ติดตามนักเรียนรายวัน — วันนี้ใครไม่มา ใครมาสาย ใครมาแล้วไม่เข้าเรียน
 *
 * เห็นได้เฉพาะ Admin กับ Executive (ADMIN_OR_EXECUTIVE) — เป็นข้อมูลพฤติกรรมรายคน
 * ทั้งโรงเรียน ไม่ใช่ของครูรายวิชา
 *
 * ⚠️ **แม่นเท่าที่ครูเช็คครบเท่านั้น** คาบที่ไม่มีแถวเลย แยกไม่ออกระหว่าง "เด็กอยู่ในคาบ"
 * กับ "ครูไม่ได้เช็ค" กติกาข้างล่างจึงตัดสินจาก **คาบที่มีข้อมูล** เท่านั้น ไม่เดาแทนคาบที่ว่าง
 */

const { query } = require('../lib/db');
const { schoolToday } = require('../lib/schoolDate');

// flag_status ที่แปลว่ามาเข้าแถว — ชุดเดียวกับที่ getMassiveAttendanceGrid ใช้
const PRESENT_FLAGS = ['มา', 'เข้าแถว', 'เข้า', 'ปกติ'];

const isHere    = (st) => st === 'มา' || st === 'สาย';
const isMissing = (st) => st === 'ขาด' || st === 'โดด';

/**
 * จำแนกอาการของนักเรียนหนึ่งคนในหนึ่งวัน
 * `rows` = คาบที่มีข้อมูลของวันนั้น (ตัด 'ลา' ออกแล้ว) · `atAssembly` = เข้าแถวไหม (null = ไม่มีข้อมูล)
 *
 * เด็กคนเดียวมีได้หลายอาการ — สายตอนเช้าแล้วโดดคาบบ่ายเกิดจริงและเป็นคนละเรื่อง
 */
function classify(rows, atAssembly) {
  const out = [];
  if (!rows.length) return out;

  const anyHere    = rows.some(r => isHere(r.status));
  const missing    = rows.filter(r => isMissing(r.status));
  const markedSkip = rows.some(r => r.status === 'โดด');

  if (rows.some(r => r.status === 'สาย')) out.push('late');

  // โดด: ครูกดเอง หรือสรุปได้ว่ามาโรงเรียนแล้วหายไปบางคาบ
  if (markedSkip || (missing.length && anyHere)) out.push('skip');

  if (!anyHere && missing.length) {
    // เข้าแถวแล้วแต่ไม่เข้าเรียนเลยสักคาบ = มาแล้วหนี ไม่ใช่ไม่มาโรงเรียน
    // ผู้ปกครองต้องได้ยินคนละเรื่องกัน
    if (atAssembly === true) out.push('fled');
    else if (atAssembly === false || atAssembly === null) out.push('away');
  }
  return out;
}

/** คาบที่หายไป เอาไว้โชว์ว่าโดดคาบไหน */
function missedPeriods(rows) {
  return rows.filter(r => isMissing(r.status)).map(r => r.period);
}

async function _dayRows(dateStr) {
  const [attRes, mornRes] = await Promise.all([
    query(
      `SELECT a.student_id, a.student_name, a.class, a.period, a.status,
              a.subject_code, a.subject_name
       FROM attendance a
       WHERE a.date=$1 AND a.subject_code NOT LIKE 'CLUB_%'
       ORDER BY a.student_id, a.period::text`,
      [dateStr]
    ),
    query(
      `SELECT student_id, flag_status FROM morning_activity WHERE date=$1`,
      [dateStr]
    ),
  ]);

  const assembly = new Map();
  for (const r of mornRes.rows) {
    if (r.flag_status == null || r.flag_status === '') continue;
    assembly.set(String(r.student_id), PRESENT_FLAGS.includes(String(r.flag_status).trim()));
  }
  return { attRows: attRes.rows, assembly };
}

/**
 * getDailyStudentWatch([dateStr]) — ไม่ส่งวัน = วันนี้ตามเวลาโรงเรียน
 * คืนเฉพาะนักเรียนที่ **มีอาการ** — โรงเรียน 600 คน วันปกติมีอาการ 10-30 คน
 * แสดงทุกคนคือเลื่อนผ่าน 570 แถวที่เขียนว่า "ปกติ"
 */
async function getDailyStudentWatch([dateStr]) {
  const date = String(dateStr || '').slice(0, 10) || schoolToday();
  const { attRows, assembly } = await _dayRows(date);

  const byStudent = new Map();
  for (const r of attRows) {
    const id = String(r.student_id);
    if (!byStudent.has(id)) {
      byStudent.set(id, { studentId: id, name: r.student_name || id, className: r.class || '', rows: [] });
    }
    // 'ลา' ไม่ใช่อาการ และต้องไม่ทำให้คาบอื่นถูกตีความผิด — ลาครึ่งวันแล้วมาบ่าย
    // ถ้าไม่ตัดออกจะกลายเป็น "โดดคาบเช้า"
    if (r.status === 'ลา') continue;
    byStudent.get(id).rows.push({ period: String(r.period), status: r.status,
      subjectCode: r.subject_code, subjectName: r.subject_name });
  }

  const students = [];
  for (const s of byStudent.values()) {
    const atAssembly = assembly.has(s.studentId) ? assembly.get(s.studentId) : null;
    const symptoms = classify(s.rows, atAssembly);
    if (!symptoms.length) continue;
    students.push({
      studentId: s.studentId, name: s.name, className: s.className,
      symptoms, atAssembly,
      missedPeriods: missedPeriods(s.rows),
      periods: s.rows.sort((a, b) => Number(a.period) - Number(b.period)),
    });
  }

  students.sort((a, b) =>
    a.className.localeCompare(b.className, 'th') || a.name.localeCompare(b.name, 'th'));

  const counts = { late: 0, skip: 0, fled: 0, away: 0 };
  for (const s of students) for (const k of s.symptoms) counts[k]++;

  return { date, counts, students, checkedStudents: byStudent.size };
}

/**
 * getStudentAttendanceProfile([studentId, term, year]) — สรุปสะสมของเด็กคนเดียว
 * ตอบคำถามที่ตามมาทันทีหลังเห็นชื่อบนหน้ารายวัน: "คนนี้เป็นบ่อยไหม คาบไหน"
 */
async function getStudentAttendanceProfile([studentId, term, year]) {
  const sid = String(studentId || '').trim();
  if (!sid) throw new Error('ไม่ได้ระบุรหัสนักเรียน');

  const { rows } = await query(
    `SELECT to_char(date,'YYYY-MM-DD') AS d, period, status, subject_code, subject_name, class
     FROM attendance
     WHERE student_id=$1 AND term=$2 AND year=$3 AND subject_code NOT LIKE 'CLUB_%'
     ORDER BY date, period::text`,
    [sid, String(term), String(year)]
  );
  const mornRes = await query(
    `SELECT to_char(date,'YYYY-MM-DD') AS d, flag_status
     FROM morning_activity WHERE student_id=$1 AND term=$2 AND year=$3`,
    [sid, String(term), String(year)]
  );
  const assembly = new Map();
  for (const r of mornRes.rows) {
    if (r.flag_status == null || r.flag_status === '') continue;
    assembly.set(r.d, PRESENT_FLAGS.includes(String(r.flag_status).trim()));
  }

  const byDay = new Map();
  for (const r of rows) {
    if (r.status === 'ลา') continue;
    if (!byDay.has(r.d)) byDay.set(r.d, []);
    byDay.get(r.d).push({ period: String(r.period), status: r.status,
      subjectCode: r.subject_code, subjectName: r.subject_name });
  }

  const totals = { late: 0, skip: 0, fled: 0, away: 0 };
  const byPeriod = {};    // คาบไหนหายบ่อย
  const bySubject = {};   // วิชาไหนหายบ่อย
  const days = [];
  for (const [d, dayRows] of byDay) {
    const symptoms = classify(dayRows, assembly.has(d) ? assembly.get(d) : null);
    if (!symptoms.length) continue;
    for (const k of symptoms) totals[k]++;
    for (const r of dayRows) {
      if (!isMissing(r.status)) continue;
      byPeriod[r.period] = (byPeriod[r.period] || 0) + 1;
      const key = `${r.subjectCode}|${r.subjectName || r.subjectCode}`;
      bySubject[key] = (bySubject[key] || 0) + 1;
    }
    days.push({ date: d, symptoms, missedPeriods: missedPeriods(dayRows) });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));

  const className = rows.length ? (rows[rows.length - 1].class || '') : '';
  return {
    studentId: sid, className, term: String(term), year: String(year),
    totals, days,
    byPeriod: Object.entries(byPeriod)
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => b.count - a.count || Number(a.period) - Number(b.period)),
    bySubject: Object.entries(bySubject)
      .map(([k, count]) => ({ subjectCode: k.split('|')[0], subjectName: k.split('|')[1], count }))
      .sort((a, b) => b.count - a.count),
  };
}

module.exports = { getDailyStudentWatch, getStudentAttendanceProfile, classify };
