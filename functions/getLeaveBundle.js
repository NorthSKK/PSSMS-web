const { query } = require('../lib/db');

function rowToLeave(r) {
  return {
    leaveId:      r.id || '',
    teacherId:    r.teacher_id || '',
    teacherName:  r.staff_name || '',
    type:         r.type || '',
    startDate:    r.start_date ? String(r.start_date).slice(0, 10) : '',
    endDate:      r.end_date   ? String(r.end_date).slice(0, 10)   : '',
    days:         Number(r.days || 1),
    reason:       r.reason       || '',
    status:       r.status       || 'รอพิจารณา',
    year:         r.year         || '',
    requestDate:  r.request_date ? String(r.request_date) : '',
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

async function getLeaveRequestBundle([teacherId, year]) {
  const params = [teacherId];
  let sql = `SELECT * FROM leave_records WHERE teacher_id=$1`;
  if (year) { params.push(year); sql += ` AND year=$${params.length}`; }
  sql += ' ORDER BY request_date DESC';

  const { rows } = await query(sql, params);
  const byType = {};
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
  return {
    stats: Object.entries(byType).map(([type, count]) => ({ type, count })),
    history: rows.map(rowToLeave),
  };
}

async function getPendingSubstitutes() {
  const { rows } = await query(
    `SELECT * FROM substitute_assignments WHERE status='รอจัด' ORDER BY date`
  );
  return rows.map(r => ({
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
    class:  r.class || '',
    room:   r.room  || '',
    status: r.status || '',
  }));
}

module.exports = { getPendingLeaves, getLeaveRequestBundle, getPendingSubstitutes };
