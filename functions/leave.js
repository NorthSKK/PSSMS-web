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

async function reviewLeave([leaveId, status, comment, reviewerName]) {
  const dbStatus = status === 'อนุมัติ' ? 'อนุมัติ' : 'ปฏิเสธ';
  await query(
    `UPDATE leave_records SET status=$1, reviewed_by=$2, admin_comment=$3 WHERE id=$4`,
    [dbStatus, reviewerName || '', comment || '', leaveId]
  );
  return { status: 'success', message: 'บันทึกการพิจารณาสำเร็จ' };
}

async function assignSubstitute([assignmentId, subTeacherId, note, assignedByName]) {
  const { rows } = await query(`SELECT full_name FROM users WHERE username=$1`, [subTeacherId]);
  const subTeacherName = rows[0] ? rows[0].full_name : '';
  await query(
    `UPDATE substitute_assignments
     SET sub_teacher_id=$1, sub_teacher_name=$2, status='จัดแล้ว',
         assigned_by=$3, note=$4, assigned_at=NOW()
     WHERE id=$5`,
    [subTeacherId, subTeacherName, assignedByName || '', note || '', assignmentId]
  );
  return { status: 'success', message: 'จัดสอนแทนสำเร็จ' };
}

async function unassignSubstitute([assignmentId]) {
  await query(
    `UPDATE substitute_assignments
     SET sub_teacher_id=NULL, sub_teacher_name=NULL, status='รอจัด',
         assigned_by=NULL, note=NULL, assigned_at=NULL
     WHERE id=$1`,
    [assignmentId]
  );
  return { status: 'success', message: 'ยกเลิกการจัดแล้ว' };
}

async function updateLeave([leaveId, data]) {
  const d = data || {};
  await query(
    `UPDATE leave_records SET type=$1, start_date=$2, end_date=$3, days=$4, reason=$5 WHERE id=$6`,
    [d.type || 'ลาป่วย', d.startDate, d.endDate, parseFloat(d.days) || 1, d.reason || '', leaveId]
  );
  return { status: 'success', message: 'แก้ไขสำเร็จ' };
}

async function deleteLeave([leaveId]) {
  await query(`DELETE FROM leave_records WHERE id=$1`, [leaveId]);
  return { status: 'success', message: 'ลบสำเร็จ' };
}

async function manualCreateAffected([teacherId, startDate, endDate]) {
  const { rows: settingRows } = await query(
    `SELECT value1, value2 FROM system_settings WHERE key='Active' AND subkey='Term' LIMIT 1`
  );
  const term = settingRows[0] ? settingRows[0].value1 : '1';
  const year = settingRows[0] ? settingRows[0].value2 : '2569';

  const { rows: timetable } = await query(
    `SELECT day, period, subject_code, subject_name,
            level||'/'||room as class_name, room, full_name as teacher_name
     FROM timetable t
     JOIN users u ON u.username=t.teacher_id
     WHERE t.teacher_id=$1 AND t.term=$2 AND t.year=$3`,
    [teacherId, term, year]
  );
  if (!timetable.length) return { status: 'success', message: 'ไม่พบตารางสอน', created: 0 };

  const DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  let created = 0;
  const start = new Date(startDate);
  const end   = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayName = DAYS[d.getDay()];
    const dateStr = d.toISOString().slice(0, 10);
    for (const tt of timetable.filter(t => t.day === dayName)) {
      const { rows: exists } = await query(
        `SELECT id FROM substitute_assignments WHERE date=$1 AND period=$2 AND original_teacher_id=$3`,
        [dateStr, tt.period, teacherId]
      );
      if (!exists.length) {
        await query(
          `INSERT INTO substitute_assignments
           (date,period,day_of_week,original_teacher_id,original_teacher_name,
            subject_code,subject_name,class,room,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'รอจัด')`,
          [dateStr, tt.period, dayName, teacherId, tt.teacher_name || '',
           tt.subject_code, tt.subject_name, tt.class_name, tt.room]
        );
        created++;
      }
    }
  }
  return { status: 'success', message: `สร้าง ${created} คาบ`, created };
}

module.exports = {
  saveLeaveRequest, approveLeave, rejectLeave, reviewLeave,
  updateLeave, deleteLeave,
  assignSubstitute, unassignSubstitute, manualCreateAffected,
  saveSubstituteAssignment, confirmSubstitute,
};
