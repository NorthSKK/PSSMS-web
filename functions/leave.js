const { query } = require('../lib/db');

async function saveLeaveRequest([requestData]) {
  const r = requestData || {};
  const { rows } = await query(
    `INSERT INTO leave_records(teacher_id,staff_name,type,start_date,end_date,days,reason,status,year)
     VALUES($1,$2,$3,$4,$5,$6,$7,'รอพิจารณา',$8)
     RETURNING id`,
    [
      r.teacherId || r.teacher_id || '',
      r.staffName || r.staff_name || '',
      r.type || 'ลาป่วย',
      r.startDate || r.start_date,
      r.endDate || r.end_date,
      r.days || 1,
      r.reason || '',
      r.year || '',
    ]
  );
  return { status: 'success', message: 'ส่งคำขอลาสำเร็จ', id: rows[0].id };
}

async function approveLeave([leaveId, reviewedBy, comment]) {
  await query(
    `UPDATE leave_records SET status='อนุมัติ', reviewed_by=$1, admin_comment=$2 WHERE id=$3`,
    [reviewedBy || '', comment || '', leaveId]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function rejectLeave([leaveId, reviewedBy, comment]) {
  await query(
    `UPDATE leave_records SET status='ไม่อนุมัติ', reviewed_by=$1, admin_comment=$2 WHERE id=$3`,
    [reviewedBy || '', comment || '', leaveId]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function saveSubstituteAssignment([assignData]) {
  const a = assignData || {};
  const { rows } = await query(
    `INSERT INTO substitute_assignments(leave_id,date,period,day_of_week,original_teacher_id,original_teacher_name,sub_teacher_id,sub_teacher_name,subject_code,subject_name,class,room,status,assigned_by,note)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'รอยืนยัน',$13,$14)
     RETURNING id`,
    [
      a.leaveId || null,
      a.date, a.period || '', a.dayOfWeek || '',
      a.originalTeacherId || '', a.originalTeacherName || '',
      a.subTeacherId || '', a.subTeacherName || '',
      a.subjectCode || '', a.subjectName || '',
      a.class || '', a.room || '',
      a.assignedBy || '', a.note || '',
    ]
  );
  return { status: 'success', message: 'บันทึกการจัดสอนแทนสำเร็จ', id: rows[0].id };
}

async function confirmSubstitute([subId]) {
  await query(
    `UPDATE substitute_assignments SET status='ยืนยันแล้ว' WHERE id=$1`,
    [subId]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

module.exports = { saveLeaveRequest, approveLeave, rejectLeave, saveSubstituteAssignment, confirmSubstitute };
