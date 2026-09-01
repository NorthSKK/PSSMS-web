'use strict';
/**
 * กระดานติดตามงานครู — ครูคนไหนทำงานไปถึงไหนแล้วในเทอมปัจจุบัน
 *
 * แผนเต็มและเหตุผลของทุกการตัดสินใจอยู่ที่ docs/plan-teacher-progress-board.md
 *
 * หลักที่ต้องไม่ลืมเวลาแก้ไฟล์นี้:
 * - **ความคืบหน้าล้วน ไม่มีไฟแดง** ทุกคอลัมน์เป็นเศษส่วน grade_summary เก็บเฉพาะแถวที่
 *   กรอกครบอยู่แล้ว แถวว่างกลางเทอมแปลว่า "ยังไม่ถึงเวลา" ไม่ใช่ "ครูไม่ทำ"
 * - **โหลด DB ครั้งเดียวแล้วคำนวณในหน่วยความจำ** ห้ามยิง query ต่อคู่วิชา×ห้อง
 * - เทอมปัจจุบันเท่านั้น ไม่มี arg เลือกเทอม (ตัวหารคะแนนใช้ users.year ที่ถูกทับตอน promote)
 */

const { query } = require('../lib/db');
const cache = require('../lib/cache');
const { slotsFromRows, expandSlots } = require('../lib/sessionCalendar');
const { schoolToday } = require('../lib/schoolDate');
const { _holidayDates } = require('./attendance');
const { subjectPrefixOf, isHomeroomSubject } = require('../lib/subjectGroup');

const CACHE_TTL = 600;
const normalize = (s) => String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');

// คาบที่นับเข้ากระดาน: รายวิชาจริง + โฮมรูม
// `-` (แนะแนว/วิถีพุทธ) ไม่มีตารางเก็บผลการเช็คเลย นับเมื่อไหร่ก็ค้าง 100% ตลอดกาล
// `CLUB_*` เช็คเข้า attendance ก็จริง แต่เป็นกิจกรรมพัฒนาผู้เรียน ไม่ใช่เวลาเรียนรายวิชา
function isTrackedSubject(code) {
  return isHomeroomSubject(code) || subjectPrefixOf(code) !== '';
}

async function _loadBoard() {
  const config = await require('./getSystemConfig')();
  const term = String(config.term);
  const year = String(config.year);

  const [ttRes, termRes, attRes, mornRes, cfgRes, gradeRes, studRes] = await Promise.all([
    query(
      `SELECT t.teacher_id, t.subject_code, t.subject_name, t.level, t.room, t.day, t.period,
              u.full_name
       FROM timetable t LEFT JOIN users u ON u.username = t.teacher_id
       WHERE t.term=$1 AND t.year=$2`,
      [term, year]
    ),
    query(
      `SELECT value1, value2 FROM system_settings WHERE key='TermData' AND subkey=$1`,
      [`${term}_${year}`]
    ),
    // ตัวเศษของคอลัมน์เช็คชื่อ — จงใจ **ไม่กรอง teacher_id**: ถ้าครูสอนแทนเป็นคนเช็ค
    // คาบนั้นก็ถูกเช็คแล้วจริง ๆ เจ้าของคาบไม่ควรค้าง
    query(
      `SELECT DISTINCT subject_code, class, to_char(date,'YYYY-MM-DD') AS d, period
       FROM attendance WHERE term=$1 AND year=$2`,
      [term, year]
    ),
    // โฮมรูมเก็บผลที่ morning_activity ไม่ใช่ attendance — มีแถวของ class+date นั้น
    // = เช็คแล้ว ไม่ดูว่ากรอกครบกี่ช่องใน area/duty/flag แต่ละโรงเรียนใช้ไม่เหมือนกัน
    query(
      `SELECT DISTINCT class, to_char(date,'YYYY-MM-DD') AS d
       FROM morning_activity WHERE term=$1 AND year=$2`,
      [term, year]
    ),
    query(`SELECT subject_code, class_name FROM subject_config WHERE term=$1 AND year=$2`, [term, year]),
    // grade_summary ไม่มีคอลัมน์ห้อง — ห้องมาจาก users.department ของนักเรียน
    query(
      `SELECT g.subject_code, u.department AS class, COUNT(*) AS cnt
       FROM grade_summary g JOIN users u ON u.username = g.student_id
       WHERE g.term=$1 AND g.year=$2
       GROUP BY g.subject_code, u.department`,
      [term, year]
    ),
    // ⚠️ department ของ record นักเรียนคือ "ห้องเรียน" (ม.2/1) ไม่ใช่วิชาเอกแบบของครู
    query(
      `SELECT department AS class, COUNT(*) AS cnt FROM users
       WHERE UPPER(role)='STUDENT' AND year=$1 AND status='ปกติ'
       GROUP BY department`,
      [year]
    ),
  ]);

  const startRaw = termRes.rows[0]?.value1;
  const start = startRaw ? new Date(`${String(startRaw).slice(0, 10)}T00:00:00Z`) : null;
  const termEnd = termRes.rows[0]?.value2 ? new Date(`${String(termRes.rows[0].value2).slice(0, 10)}T00:00:00Z`) : null;
  const today = new Date(`${schoolToday()}T00:00:00Z`);
  const end = termEnd && termEnd < today ? termEnd : today;
  const datedTerm = start && !isNaN(start) && start <= end;
  const holidays = datedTerm ? await _holidayDates(start, end) : new Set();

  const checked = new Set(attRes.rows.map(r => `${r.subject_code}|${normalize(r.class)}|${r.d}|${r.period}`));
  const homeroomChecked = new Set(mornRes.rows.map(r => `${normalize(r.class)}|${r.d}`));
  const configured = new Set(cfgRes.rows.map(r => `${r.subject_code}|${normalize(r.class_name)}`));
  const graded = new Map(gradeRes.rows.map(r => [`${r.subject_code}|${normalize(r.class)}`, parseInt(r.cnt)]));
  const classSize = new Map(studRes.rows.map(r => [normalize(r.class), parseInt(r.cnt)]));

  // จับกลุ่ม timetable เป็นคู่ ครู × วิชา × ห้อง — หนึ่งคู่มีได้หลายคาบต่อสัปดาห์
  const pairs = new Map();
  for (const r of ttRes.rows) {
    if (!isTrackedSubject(r.subject_code)) continue;
    const className = `${r.level}/${r.room}`;
    const key = `${r.teacher_id}|${r.subject_code}|${normalize(className)}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        teacherId: String(r.teacher_id),
        teacherName: r.full_name || String(r.teacher_id),
        subjectCode: r.subject_code,
        subjectName: r.subject_name || r.subject_code,
        className,
        rows: [],
      });
    }
    pairs.get(key).rows.push(r);
  }

  const teachers = new Map();
  for (const p of pairs.values()) {
    const normClass = normalize(p.className);
    const isHR = isHomeroomSubject(p.subjectCode);
    const expected = datedTerm ? expandSlots(slotsFromRows(p.rows), start, end, holidays) : [];

    let done = 0;
    for (const e of expected) {
      const hit = isHR
        ? homeroomChecked.has(`${normClass}|${e.date}`)
        : checked.has(`${p.subjectCode}|${normClass}|${e.date}|${e.period}`);
      if (hit) done++;
    }

    // โฮมรูมไม่มี subject_config และไม่มีคะแนน — ไม่เข้าตัวหารของสองคอลัมน์นั้น
    const configExpected = isHR ? 0 : 1;
    const configDone = isHR ? 0 : (configured.has(`${p.subjectCode}|${normClass}`) ? 1 : 0);
    const scoreExpected = isHR ? 0 : (classSize.get(normClass) || 0);
    const scoreDone = isHR ? 0 : Math.min(graded.get(`${p.subjectCode}|${normClass}`) || 0, scoreExpected);

    if (!teachers.has(p.teacherId)) {
      teachers.set(p.teacherId, {
        teacherId: p.teacherId,
        name: p.teacherName,
        attendance: { done: 0, expected: 0 },
        config: { done: 0, expected: 0 },
        scores: { done: 0, expected: 0 },
        subjects: [],
      });
    }
    const t = teachers.get(p.teacherId);
    t.attendance.done += done;
    t.attendance.expected += expected.length;
    t.config.done += configDone;
    t.config.expected += configExpected;
    t.scores.done += scoreDone;
    t.scores.expected += scoreExpected;
    t.subjects.push({
      subjectCode: p.subjectCode,
      subjectName: p.subjectName,
      className: p.className,
      isHomeroom: isHR,
      attendance: { done, expected: expected.length },
      config: { done: configDone, expected: configExpected },
      scores: { done: scoreDone, expected: scoreExpected },
    });
  }

  const list = [...teachers.values()];
  for (const t of list) {
    t.subjects.sort((a, b) =>
      a.subjectCode.localeCompare(b.subjectCode, 'th') || a.className.localeCompare(b.className, 'th'));
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'th'));

  const totals = { attendance: { done: 0, expected: 0 }, config: { done: 0, expected: 0 }, scores: { done: 0, expected: 0 } };
  for (const t of list) {
    for (const k of ['attendance', 'config', 'scores']) {
      totals[k].done += t[k].done;
      totals[k].expected += t[k].expected;
    }
  }

  return { ts: Date.now(), term, year, datedTerm, totals, teachers: list };
}

// key เดียวไม่มี role — Admin กับ Executive เห็นเหมือนกันทุกประการ (docs/adr/0001)
// ⚠️ ใครกลับมา scope ตาม dept ต้องแก้คีย์นี้พร้อมกัน ไม่งั้นข้อมูลรั่วข้ามคน
async function getTeacherProgressBoard() {
  const config = await require('./getSystemConfig')();
  const key = `progress_board_${config.term}_${config.year}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const board = await _loadBoard();
  cache.set(key, board, CACHE_TTL);
  return board;
}

module.exports = { getTeacherProgressBoard, isTrackedSubject };
