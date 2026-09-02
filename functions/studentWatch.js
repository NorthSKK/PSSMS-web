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
const cache = require('../lib/cache');
const { schoolToday } = require('../lib/schoolDate');

const CACHE_TTL = 600;

// flag_status ที่แปลว่ามาเข้าแถว — ชุดเดียวกับที่ getMassiveAttendanceGrid ใช้
const PRESENT_FLAGS = ['มา', 'เข้าแถว', 'เข้า', 'ปกติ'];

const isMissing = (st) => st === 'ขาด' || st === 'โดด';

/**
 * ยุบคาบของหนึ่งคนหนึ่งวันเป็นยอดนับ — `ลา` ต้องถูกตัดออกก่อนถึงจะมาที่นี่
 * (หน้ารายวันตัดตอนอ่านแถว ส่วนอันดับสะสมตัดใน SQL)
 */
function summarize(rows) {
  const c = { present: 0, late: 0, absent: 0, skip: 0 };
  for (const r of rows) {
    if (r.status === 'มา') c.present++;
    else if (r.status === 'สาย') c.late++;
    else if (r.status === 'ขาด') c.absent++;
    else if (r.status === 'โดด') c.skip++;
  }
  return c;
}

/**
 * จำแนกอาการของนักเรียนหนึ่งคนในหนึ่งวัน — **กติกาอยู่ที่นี่ที่เดียว**
 *
 * รับ **ยอดนับ** ไม่ใช่แถวดิบ เพราะอันดับสะสมให้ SQL ยุบเป็น 1 แถวต่อ นักเรียน×วัน
 * มาก่อน (420,000 แถวต่อเทอมดึงเข้า node ไม่ไหว) ถ้าให้รับแถวดิบ อันดับสะสมจะต้อง
 * เขียนกติกาซ้ำใน SQL แล้วสองสูตรจะ drift
 *
 * `c` = { present, late, absent, skip } · `atAssembly` = เข้าแถวไหม (null = ไม่มีข้อมูล)
 * เด็กคนเดียวมีได้หลายอาการ — สายตอนเช้าแล้วโดดคาบบ่ายเกิดจริงและเป็นคนละเรื่อง
 */
function classify(c, atAssembly) {
  const out = [];
  const total = c.present + c.late + c.absent + c.skip;
  if (!total) return out;

  const anyHere = c.present > 0 || c.late > 0;
  const missing = c.absent + c.skip;

  if (c.late > 0) out.push('late');

  // โดด: ครูกดเอง หรือสรุปได้ว่ามาโรงเรียนแล้วหายไปบางคาบ
  if (c.skip > 0 || (missing > 0 && anyHere)) out.push('skip');

  if (!anyHere && missing > 0) {
    // เข้าแถวแล้วแต่ไม่เข้าเรียนเลยสักคาบ = มาแล้วหนี ไม่ใช่ไม่มาโรงเรียน
    // ผู้ปกครองต้องได้ยินคนละเรื่องกัน
    if (atAssembly === true) out.push('fled');
    else out.push('away');
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
    const symptoms = classify(summarize(s.rows), atAssembly);
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
    const symptoms = classify(summarize(dayRows), assembly.has(d) ? assembly.get(d) : null);
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

/**
 * getStudentWatchRanking([days]) — อันดับเด็กสะสม แยก 4 ลิสต์ตามอาการ
 *
 * `days` = 7 / 30 / 0 (0 = ทั้งภาคเรียน) · default 30
 *
 * **เรียงด้วยเลขดิบ ไม่ใช่อัตราส่วน** และ **ไม่มี % เวลาเรียน** — ดู
 * docs/adr/0002-behaviour-stats-never-restate-attendance-percent.md
 * ตัวหาร (`daysWithData`) แสดงเป็นข้อความให้คนอ่านตีความเอง เพราะมันสะท้อน
 * ความขยันเช็คชื่อของครู ไม่ใช่พฤติกรรมของเด็ก เอาไปหารแล้วชี้นิ้วผิดคน
 */
const RANK_SIZE = 10;
const MIN_OCCURRENCES = 2;   // ต่ำกว่านี้ยังไม่เป็นรูปแบบ แค่วันแย่ ๆ วันเดียว
const ALLOWED_DAYS = [0, 7, 30];

async function getStudentWatchRanking([days]) {
  let window = Number(days);
  if (!ALLOWED_DAYS.includes(window)) window = 30;

  const config = await require('./getSystemConfig')();
  const term = String(config.term);
  const year = String(config.year);
  const key = `student_rank_${term}_${year}_${window}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // ยุบเป็น 1 แถวต่อ นักเรียน×วัน ใน SQL ก่อน — ทั้งเทอมมีแถวรายคาบระดับ 4 แสนแถว
  // ดึงเข้า node ทั้งหมดไม่ไหว · 'ลา' ตัดทิ้งที่นี่ ตรงกับที่หน้ารายวันตัดตอนอ่านแถว
  const since = window ? `${window} days` : null;
  const [dayRes, mornRes] = await Promise.all([
    query(
      // ชื่อดึงจาก users สด ไม่ใช่ attendance.student_name ที่ copy ไว้ตอนเช็คชื่อ —
      // เด็กเปลี่ยนชื่อ-สกุลแล้วแถวเก่าจะค้างชื่อเดิม · LEFT JOIN เพราะเด็กที่ถูกลบ/
      // เลื่อนชั้นไปแล้วต้องยังขึ้นอันดับได้ ตกกลับไปใช้ชื่อในแถวเช็คชื่อ
      `SELECT a.student_id,
              COALESCE(MAX(u.full_name), MAX(a.student_name)) AS name,
              MAX(a.class)      AS class,
              to_char(a.date,'YYYY-MM-DD') AS d,
              COUNT(*) FILTER (WHERE a.status='มา')  AS present,
              COUNT(*) FILTER (WHERE a.status='สาย') AS late,
              COUNT(*) FILTER (WHERE a.status='ขาด') AS absent,
              COUNT(*) FILTER (WHERE a.status='โดด') AS skip
       FROM attendance a
       LEFT JOIN users u ON u.username = a.student_id
       WHERE a.term=$1 AND a.year=$2 AND a.status <> 'ลา'
         AND a.subject_code NOT LIKE 'CLUB_%'
         AND ($3::text IS NULL OR a.date >= CURRENT_DATE - $3::interval)
       GROUP BY a.student_id, a.date`,
      [term, year, since]
    ),
    query(
      `SELECT student_id, to_char(date,'YYYY-MM-DD') AS d, flag_status
       FROM morning_activity
       WHERE term=$1 AND year=$2
         AND ($3::text IS NULL OR date >= CURRENT_DATE - $3::interval)`,
      [term, year, since]
    ),
  ]);

  const assembly = new Map();
  for (const r of mornRes.rows) {
    if (r.flag_status == null || r.flag_status === '') continue;
    assembly.set(`${r.student_id}|${r.d}`, PRESENT_FLAGS.includes(String(r.flag_status).trim()));
  }

  const people = new Map();
  for (const r of dayRes.rows) {
    const id = String(r.student_id);
    if (!people.has(id)) {
      people.set(id, {
        studentId: id, name: r.name || id, className: r.class || '',
        daysWithData: 0,
        counts: { late: 0, skip: 0, fled: 0, away: 0 },
        last:   { late: '', skip: '', fled: '', away: '' },
      });
    }
    const p = people.get(id);
    p.daysWithData++;
    const key2 = `${id}|${r.d}`;
    const symptoms = classify({
      present: Number(r.present), late: Number(r.late),
      absent: Number(r.absent),   skip: Number(r.skip),
    }, assembly.has(key2) ? assembly.get(key2) : null);
    for (const k of symptoms) {
      p.counts[k]++;
      if (r.d > p.last[k]) p.last[k] = r.d;   // 'YYYY-MM-DD' เทียบเป็นสตริงได้ตรง ๆ
    }
  }

  const lists = {};
  for (const k of ['away', 'fled', 'skip', 'late']) {
    lists[k] = [...people.values()]
      .filter(p => p.counts[k] >= MIN_OCCURRENCES)
      .sort((a, b) => b.counts[k] - a.counts[k] || b.last[k].localeCompare(a.last[k]))
      .slice(0, RANK_SIZE)
      .map(p => ({
        studentId: p.studentId, name: p.name, className: p.className,
        count: p.counts[k], daysWithData: p.daysWithData, lastDate: p.last[k],
      }));
  }

  const out = {
    term, year, days: window,
    minOccurrences: MIN_OCCURRENCES,
    studentsWithData: people.size,
    lists,
  };
  cache.set(key, out, CACHE_TTL);
  return out;
}

module.exports = {
  getDailyStudentWatch, getStudentAttendanceProfile, getStudentWatchRanking,
  classify, summarize,
};
