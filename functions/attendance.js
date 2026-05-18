const { query } = require('../lib/db');

async function saveAttendanceBatch([list]) {
  if (!Array.isArray(list) || list.length === 0) return { status: 'success', saved: 0 };

  const first = list[0];
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
         item.status, sessionId, item.teacherId || '']
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

async function saveLessonRecord([record]) {
  const r = record || {};
  await query(
    `INSERT INTO academic_records(date,term,year,subject_code,subject_name,class,period,topic,present,absent,leave,teacher_id,session_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT DO NOTHING`,
    [
      r.date, r.term, r.year, r.subjectCode, r.subjectName,
      r.className, r.period, r.topic || '',
      r.present || 0, r.absent || 0, r.leave || 0,
      r.teacherId || '', r.sessionId || '',
    ]
  );
  return { status: 'success' };
}

async function updateAttendanceStatus([sessionId, studentId, newStatus]) {
  await query(
    `UPDATE attendance SET status=$1 WHERE session_id=$2 AND student_id=$3`,
    [newStatus, sessionId, studentId]
  );
  return { status: 'success' };
}

async function updateAttendanceBatch([updates]) {
  if (!Array.isArray(updates) || updates.length === 0) return { status: 'success', message: 'ไม่มีรายการที่ต้องแก้ไข' };
  for (const u of updates) {
    await query(
      `UPDATE attendance SET status=$1 WHERE id=$2`,
      [u.status, u.rowIdx]
    );
  }
  return { status: 'success', message: `อัปเดตสำเร็จ ${updates.length} รายการ` };
}

async function getTodayAttendanceHistory([date, subjectCode, className]) {
  const { rows } = await query(
    `SELECT id, student_id, student_name, status, period, session_id,
            to_char(date,'YYYY-MM-DD') as date
     FROM attendance
     WHERE date=$1 AND subject_code=$2 AND class=$3
     ORDER BY student_id`,
    [date, subjectCode, className]
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

async function getCourseSessionList([teacherId, subjectCode, className, term, year]) {
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

async function getMassiveAttendanceGrid([teacherId, subjectCode, className, term, year]) {
  const studentsRes = await require('./students').getStudentsByClass([
    className,
    null,
  ]);

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
    `SELECT id, student_id, session_id, status
     FROM attendance
     WHERE teacher_id=$1 AND subject_code=$2 AND class=$3 AND term=$4 AND year=$5`,
    [teacherId, subjectCode, className, term, year]
  );

  const attendanceMap = {};
  for (const r of attRes.rows) {
    if (!attendanceMap[r.student_id]) attendanceMap[r.student_id] = {};
    attendanceMap[r.student_id][r.session_id] = { status: r.status, rowIdx: r.id };
  }

  return {
    students: studentsRes,
    sessions: sessionsRes.rows.map(r => ({
      sessionId: r.session_id,
      date: r.date,
      period: r.period,
    })),
    attendanceMap,
  };
}

async function saveMassiveAttendanceGrid([updates, newRows]) {
  if (Array.isArray(updates)) {
    for (const u of updates) {
      await query(`UPDATE attendance SET status=$1 WHERE id=$2`, [u.status, u.rowIdx]);
    }
  }
  if (Array.isArray(newRows) && newRows.length > 0) {
    for (const r of newRows) {
      await query(
        `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.date, r.term, r.year, r.subjectCode, r.subjectName, r.className,
         r.period, r.studentId, r.studentName, r.status, r.sessionId, r.teacherId || '']
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
