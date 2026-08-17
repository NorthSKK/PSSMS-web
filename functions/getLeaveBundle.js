const { query } = require('../lib/db');

const fmtDate = (d) => d instanceof Date ? d.toISOString().slice(0, 10) : (d ? String(d).slice(0, 10) : '');

function rowToLeave(r) {
  return {
    leaveId:      r.id || '',
    teacherId:    r.teacher_id || '',
    teacherName:  r.staff_name || '',
    type:         r.type || '',
    startDate:    fmtDate(r.start_date),
    endDate:      fmtDate(r.end_date),
    days:         Number(r.days || 1),
    reason:       r.reason       || '',
    status:       r.status       || 'รอพิจารณา',
    year:         r.year         || '',
    requestDate:  r.request_date ? fmtDate(r.request_date) : '',
    comment:      r.admin_comment || '',
    reviewerName: r.reviewed_by   || '',
  };
}

async function getPendingLeaves() {
  const { rows } = await query(
    `SELECT * FROM leave_records WHERE status='รอพิจารณา' ORDER BY request_date DESC`
  );
  return rows.map(rowToLeave);
}

const LEAVE_LIMITS = {
  'ลาป่วย': 60, 'ลากิจ': 45, 'ลาพักร้อน': 10,
  'ลาคลอด': 90, 'ลาบวช': 120,
};

async function getLeaveRequestBundle([teacherId, year]) {
  const params = [teacherId];
  let sql = `SELECT * FROM leave_records WHERE teacher_id=$1`;
  if (year) { params.push(year); sql += ` AND year=$${params.length}`; }
  sql += ' ORDER BY request_date DESC';

  const { rows } = await query(sql, params);
  const byType = {};
  for (const r of rows) {
    if (!byType[r.type]) byType[r.type] = 0;
    byType[r.type] += Number(r.days || 1);
  }
  const stats = Object.entries(byType).map(([type, used]) => ({
    type,
    used,
    limit: LEAVE_LIMITS[type] || 9999,
  }));
  return { stats, history: rows.map(rowToLeave) };
}

async function getPendingSubstitutes([from, to] = []) {
  const params = [];
  let where = '';
  if (from && to) {
    params.push(from, to);
    where = `WHERE s.date >= $1 AND s.date <= $2`;
  }
  // LEFT JOIN — คาบที่สร้างเองด้วย "เพิ่มเอง" ไม่มี leave_id ต้องไม่หายไปจากรายการ
  const { rows } = await query(
    `SELECT s.*, l.type AS leave_type, l.reason AS leave_reason
       FROM substitute_assignments s
       LEFT JOIN leave_records l ON l.id = s.leave_id
       ${where} ORDER BY s.date`,
    params
  );
  return rows.map(r => ({
    id:                  r.id || '',
    assignmentId:        r.id || '',
    leaveId:             r.leave_id || '',
    date:                r.date ? String(r.date).slice(0, 10) : '',
    period:              r.period || '',
    dayOfWeek:           r.day_of_week || '',
    originalTeacherId:   r.original_teacher_id || '',
    originalTeacherName: r.original_teacher_name || '',
    substituteTeacherId: r.sub_teacher_id || '',
    substituteTeacherName: r.sub_teacher_name || '',
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    className: r.class || '',
    room:      r.room  || '',
    status:    r.status || '',
    leaveType:   r.leave_type   || '',
    leaveReason: r.leave_reason || '',
  }));
}

module.exports = { getPendingLeaves, getLeaveRequestBundle, getPendingSubstitutes };
