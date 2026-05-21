const { query } = require('../lib/db');

async function saveAttendanceBatch([list], user) {
  if (!Array.isArray(list) || list.length === 0) return { status: 'success', saved: 0 };

  const teacherId = String(user?.id || '');
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

  return {
    students: studentsRes,
    sessions: sessionsRes.rows.map(r => ({
      sessionId: r.session_id,
      date: r.date,
      period: r.period,
      displayDate: toThaiDate(r.date),
    })),
    attendance,
  };
}

// args: subjectCode, subjectName, className, term, year, updates, newRecords, teacherId
async function saveMassiveAttendanceGrid([subjectCode, subjectName, className, term, year, updates, newRecords, teacherId]) {
  const isHR = String(subjectCode).toUpperCase() === 'HR';

  const hrColMap = { area: 'area_status', duty: 'duty_status', flag: 'flag_status' };
  if (Array.isArray(updates)) {
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
         r.period, r.studentId, r.studentName, r.status, sessionId, teacherId || '']
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
