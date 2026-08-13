const { query } = require('../lib/db');
const { isAdmin, verifyTeacherOwnsSubject, verifySessionOwner, verifyAttendanceBatchOwner, verifyMorningBatchOwner } = require('../lib/permissions');

async function saveAttendanceBatch([list], user) {
  if (!Array.isArray(list) || list.length === 0) return { status: 'success', saved: 0 };

  const teacherId = String(user?.id || '');
  const first = list[0];
  await verifyTeacherOwnsSubject(user, first.subjectCode, first.className, first.term, first.year);
  const sessionId = `${first.date}|${first.subjectCode}|${first.className}|${first.period}`;
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM attendance WHERE session_id=$1`, [sessionId]);
    for (const item of list) {
      await client.query(
        `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [item.date, item.term, item.year, item.subjectCode, item.subjectName,
         item.className, item.period, item.studentId, item.studentName,
         item.status, sessionId, teacherId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { status: 'success', saved: list.length, sessionId };
}

async function saveLessonRecord([record], user) {
  const r = record || {};
  await verifyTeacherOwnsSubject(user, r.subjectCode, r.className, r.term, r.year);
  await query(
    `INSERT INTO academic_records(date,term,year,subject_code,subject_name,class,period,topic,present,absent,leave,teacher_id,session_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT DO NOTHING`,
    [
      r.date, r.term, r.year, r.subjectCode, r.subjectName,
      r.className, r.period, r.topic || '',
      r.present || 0, r.absent || 0, r.leave || 0,
      String(user?.id || r.teacherId || ''), r.sessionId || '',
    ]
  );
  return { status: 'success' };
}

async function updateAttendanceStatus([sessionId, studentId, newStatus], user) {
  await verifySessionOwner(user, sessionId);
  await query(
    `UPDATE attendance SET status=$1 WHERE session_id=$2 AND student_id=$3`,
    [newStatus, sessionId, studentId]
  );
  return { status: 'success' };
}

async function updateAttendanceBatch([updates], user) {
  if (!Array.isArray(updates) || updates.length === 0) return { status: 'success', message: 'ไม่มีรายการที่ต้องแก้ไข' };
  await verifyAttendanceBatchOwner(user, updates.map(u => u.rowIdx));
  await query(
    `UPDATE attendance SET status = v.status
     FROM unnest($1::int[], $2::text[]) AS v(id, status)
     WHERE attendance.id = v.id`,
    [updates.map(u => u.rowIdx), updates.map(u => u.status)]
  );
  return { status: 'success', message: `อัปเดตสำเร็จ ${updates.length} รายการ` };
}

async function getTodayAttendanceHistory([date, subjectCode, className], user) {
  const params = [date, subjectCode, className];
  let teacherFilter = '';
  if (!isAdmin(user)) {
    params.push(String(user?.id || '').trim().toLowerCase());
    teacherFilter = ` AND LOWER(teacher_id)=$${params.length}`;
  }
  const { rows } = await query(
    `SELECT id, student_id, student_name, status, period, session_id,
            to_char(date,'YYYY-MM-DD') as date
     FROM attendance
     WHERE date=$1 AND subject_code=$2 AND class=$3
       ${teacherFilter}
     ORDER BY student_id`,
    params
  );
  return rows.map(r => ({
    rowIdx: r.id,
    studentId: r.student_id,
    cleanId: r.student_id,
    studentName: r.student_name || '',
    status: r.status,
    period: r.period,
    sessionId: r.session_id,
    date: r.date,
  }));
}

async function getCourseSessionList([, subjectCode, className, term, year], user) {
  // Ignore payload teacherId; use JWT user.id (Admin may see any teacher's data via other endpoints)
  const teacherId = String(user?.id || '');
  const { rows } = await query(
    `SELECT session_id,
            to_char(MIN(date),'YYYY-MM-DD') as date,
            MIN(period) as period,
            COUNT(*) as student_count
     FROM attendance
     WHERE teacher_id=$1 AND subject_code=$2 AND class=$3 AND term=$4 AND year=$5
     GROUP BY session_id
     ORDER BY MIN(date) DESC`,
    [teacherId, subjectCode, className, term, year]
  );
  return rows.map(r => ({
    sessionId: r.session_id,
    date: r.date,
    period: r.period,
    studentCount: parseInt(r.student_count),
  }));
}

async function getMassiveAttendanceGrid([, subjectCode, className, term, year], user) {
  // Ignore payload teacherId; use JWT user.id
  const teacherId = String(user?.id || '');
  const thaiMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const toThaiDate = (dateStr) => {
    const d = new Date(dateStr);
    return `${d.getUTCDate()} ${thaiMonths[d.getUTCMonth()]}`;
  };

  const studentsRes = await require('./students').getStudentsByClass([className, null]);
  const isHR = String(subjectCode).toUpperCase() === 'HR';

  if (isHR) {
    const sessionsRes = await query(
      `SELECT to_char(date,'YYYY-MM-DD') as date
       FROM morning_activity
       WHERE teacher_id=$1 AND class=$2 AND term=$3 AND year=$4
       GROUP BY date ORDER BY date`,
      [teacherId, className, term, year]
    );
    const attRes = await query(
      `SELECT id, student_id, to_char(date,'YYYY-MM-DD') as date_str,
              CASE WHEN area_status IN ('มา','ปกติ','เข้าแถว','เข้า') THEN 'ปกติ'
                   WHEN area_status = 'ไม่ปกติ' THEN 'ไม่ปกติ'
                   ELSE 'ปกติ' END as area,
              CASE WHEN duty_status IN ('มา','ทำหน้าที่','ทำ','ปกติ') THEN 'ทำหน้าที่'
                   WHEN duty_status = 'ไม่ทำหน้าที่' THEN 'ไม่ทำหน้าที่'
                   ELSE 'ทำหน้าที่' END as duty,
              CASE WHEN flag_status IN ('มา','เข้าแถว','เข้า','ปกติ') THEN 'เข้าแถว'
                   WHEN flag_status = 'ไม่เข้าแถว' THEN 'ไม่เข้าแถว'
                   ELSE 'เข้าแถว' END as flag
       FROM morning_activity
       WHERE teacher_id=$1 AND class=$2 AND term=$3 AND year=$4`,
      [teacherId, className, term, year]
    );
    const attendance = {};
    for (const r of attRes.rows) {
      if (!attendance[r.student_id]) attendance[r.student_id] = {};
      attendance[r.student_id][r.date_str + '_area'] = { status: r.area, rowIdx: r.id };
      attendance[r.student_id][r.date_str + '_duty'] = { status: r.duty, rowIdx: r.id };
      attendance[r.student_id][r.date_str + '_flag'] = { status: r.flag, rowIdx: r.id };
    }
    // Expand each date into 3 sessions: area, duty, flag
    const sessions = [];
    for (const r of sessionsRes.rows) {
      sessions.push({ date: r.date, type: 'area', label: 'บริเวณ',   displayDate: toThaiDate(r.date) });
      sessions.push({ date: r.date, type: 'duty', label: 'หน้าที่',  displayDate: '' });
      sessions.push({ date: r.date, type: 'flag', label: 'เข้าแถว', displayDate: '' });
    }
    return { students: studentsRes, sessions, attendance, isHR: true };
  }

  const sessionsRes = await query(
    `SELECT session_id,
            to_char(MIN(date),'YYYY-MM-DD') as date,
            MIN(period) as period
     FROM attendance
     WHERE teacher_id=$1 AND subject_code=$2 AND class=$3 AND term=$4 AND year=$5
     GROUP BY session_id
     ORDER BY MIN(date)`,
    [teacherId, subjectCode, className, term, year]
  );

  const attRes = await query(
    `SELECT id, student_id, to_char(date,'YYYY-MM-DD') as date_str, period, status
     FROM attendance
     WHERE teacher_id=$1 AND subject_code=$2 AND class=$3 AND term=$4 AND year=$5`,
    [teacherId, subjectCode, className, term, year]
  );

  const attendance = {};
  for (const r of attRes.rows) {
    if (!attendance[r.student_id]) attendance[r.student_id] = {};
    attendance[r.student_id][r.date_str + '_' + r.period] = { status: r.status, rowIdx: r.id };
  }

  const sessions = sessionsRes.rows.map(r => ({
    sessionId: r.session_id,
    date: r.date,
    period: r.period,
    displayDate: toThaiDate(r.date),
  }));

  // Fill in every period the timetable says was taught but that was never checked,
  // so a teacher can backfill a missed day without hand-entering date+period.
  const expected = await _expectedSessions(subjectCode, className, term, year);
  const seen = new Set(sessions.map(s => `${s.date}_${s.period}`));
  for (const e of expected) {
    if (seen.has(`${e.date}_${e.period}`)) continue;
    seen.add(`${e.date}_${e.period}`);
    sessions.push({ sessionId: '', date: e.date, period: e.period, displayDate: toThaiDate(e.date) });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || String(a.period).localeCompare(String(b.period), undefined, { numeric: true }));

  return { students: studentsRes, sessions, attendance };
}

const THAI_DOW = { 'อาทิตย์': 0, 'จันทร์': 1, 'อังคาร': 2, 'พุธ': 3, 'พฤหัสบดี': 4, 'ศุกร์': 5, 'เสาร์': 6 };

// Every (date, period) this subject+class should have been taught, from the term
// start date up to today. Returns [] when the timetable or term dates are missing —
// the grid then falls back to showing only what was actually recorded.
async function _expectedSessions(subjectCode, className, term, year) {
  const normalize = (s) => String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');
  const normClass = normalize(className);

  const ttRes = await query(
    `SELECT day, period, level, room FROM timetable
     WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [subjectCode, String(term), String(year)]
  );
  const slots = ttRes.rows
    .filter(r => normalize(`${r.level}/${r.room}`) === normClass)
    .map(r => ({ dow: THAI_DOW[String(r.day || '').trim()], period: String(r.period) }))
    .filter(s => s.dow !== undefined);
  if (!slots.length) return [];

  const tdRes = await query(
    `SELECT value1, value2 FROM system_settings WHERE key='TermData' AND subkey=$1`,
    [`${term}_${year}`]
  );
  if (!tdRes.rows.length || !tdRes.rows[0].value1) return [];

  const start = new Date(`${String(tdRes.rows[0].value1).slice(0, 10)}T00:00:00Z`);
  const termEnd = tdRes.rows[0].value2 ? new Date(`${String(tdRes.rows[0].value2).slice(0, 10)}T00:00:00Z`) : null;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const end = termEnd && termEnd < today ? termEnd : today;
  if (isNaN(start) || start > end) return [];

  const holidays = await _holidayDates(start, end);

  const out = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    const dateStr = d.toISOString().slice(0, 10);
    if (holidays.has(dateStr)) continue;
    for (const s of slots) {
      if (s.dow === dow) out.push({ date: dateStr, period: s.period });
    }
  }
  return out;
}

// Public holidays are flagged in calendar_events by the red colour the import uses
// (#dc3545) — there is no dedicated column. Only used to suppress *generated*
// sessions; a date that already has attendance is always shown, because the school
// does sometimes teach on one (e.g. พืชมงคล 2026-05-13).
const HOLIDAY_COLOR = '#dc3545';
async function _holidayDates(start, end) {
  const days = new Set();
  const { rows } = await query(
    `SELECT to_char(start_date,'YYYY-MM-DD') as s, to_char(COALESCE(end_date,start_date),'YYYY-MM-DD') as e
     FROM calendar_events
     WHERE color=$1 AND start_date <= $3 AND COALESCE(end_date, start_date) >= $2`,
    [HOLIDAY_COLOR, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
  );
  for (const r of rows) {
    for (const d = new Date(`${r.s}T00:00:00Z`); d <= new Date(`${r.e}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      days.add(d.toISOString().slice(0, 10));
    }
  }
  return days;
}

// args: subjectCode, subjectName, className, term, year, updates, newRecords, (ignored teacherId)
async function saveMassiveAttendanceGrid([subjectCode, subjectName, className, term, year, updates, newRecords], user) {
  await verifyTeacherOwnsSubject(user, subjectCode, className, term, year);
  const teacherId = String(user?.id || '');
  const isHR = String(subjectCode).toUpperCase() === 'HR';

  const hrColMap = { area: 'area_status', duty: 'duty_status', flag: 'flag_status' };
  if (Array.isArray(updates) && updates.length > 0) {
    const rowIds = updates.map(u => u.rowIdx);
    if (isHR) {
      await verifyMorningBatchOwner(user, rowIds);
    } else {
      await verifyAttendanceBatchOwner(user, rowIds);
    }
    for (const u of updates) {
      if (isHR) {
        const col = hrColMap[u.hrType] || 'area_status';
        await query(`UPDATE morning_activity SET ${col}=$1 WHERE id=$2`, [u.status, u.rowIdx]);
      } else {
        await query(`UPDATE attendance SET status=$1 WHERE id=$2`, [u.status, u.rowIdx]);
      }
    }
  }

  if (!isHR && Array.isArray(newRecords) && newRecords.length > 0) {
    for (const r of newRecords) {
      const sessionId = `${r.date}|${subjectCode}|${className}|${r.period}`;
      await query(
        `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.date, term, year, subjectCode, subjectName, className,
         r.period, r.studentId, r.studentName, r.status, sessionId, teacherId]
      );
    }
  }

  return { status: 'success', message: 'บันทึกตารางเช็คชื่อสำเร็จ' };
}

const { getSemesterReport, getAllSubjectsReport } = require('./attendanceReport');

module.exports = {
  saveAttendanceBatch,
  saveLessonRecord,
  updateAttendanceStatus,
  updateAttendanceBatch,
  getTodayAttendanceHistory,
  getCourseSessionList,
  getMassiveAttendanceGrid,
  saveMassiveAttendanceGrid,
  getSemesterReport,
  getAllSubjectsReport,
};
