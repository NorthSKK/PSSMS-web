const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');

async function saveLeaveRequest([requestData], user) {
  const r = requestData || {};
  const { rows } = await query(
    `INSERT INTO leave_records(teacher_id,staff_name,type,start_date,end_date,days,reason,status,year)
     VALUES($1,$2,$3,$4,$5,$6,$7,'รอพิจารณา',$8)
     RETURNING id`,
    [
      String(user?.id || r.teacherId || r.teacher_id || ''),
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

// สถานะใบลามี 3 ค่าเท่านั้น — ต้องตรงกับที่ frontend กรอง (leaveTabPending/Approved/Rejected)
const LEAVE_PENDING  = 'รอพิจารณา';
const LEAVE_APPROVED = 'อนุมัติ';
const LEAVE_REJECTED = 'ปฏิเสธ';

async function _setLeaveStatus(leaveId, status, comment, user) {
  const { rowCount } = await query(
    `UPDATE leave_records SET status=$1, reviewed_by=$2, admin_comment=$3 WHERE id=$4`,
    [status, String(user?.id || ''), comment || '', leaveId]
  );
  if (rowCount === 0) throw new Error('ไม่พบใบลานี้');
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function approveLeave([leaveId, /* reviewedByName — ignored, JWT user.id used instead */, comment], user) {
  return _setLeaveStatus(leaveId, LEAVE_APPROVED, comment, user);
}

// เดิมเขียน 'ไม่อนุมัติ' ซึ่งไม่มีที่ไหนอ่าน — ใบลาจะค้างแสดงเป็น "รอพิจารณา" ตลอดไป
async function rejectLeave([leaveId, /* reviewedByName — ignored, JWT user.id used instead */, comment], user) {
  return _setLeaveStatus(leaveId, LEAVE_REJECTED, comment, user);
}

async function saveSubstituteAssignment([assignData], user) {
  const a = assignData || {};
  // assigned_by is an audit field — take it from the JWT, not the payload
  const assignedBy = isAdmin(user) ? (a.assignedBy || String(user?.id || '')) : String(user?.id || '');
  const { rows } = await query(
    `INSERT INTO substitute_assignments(leave_id,date,period,day_of_week,original_teacher_id,original_teacher_name,sub_teacher_id,sub_teacher_name,subject_code,subject_name,class,room,status,assigned_by,note)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'จัดแล้ว',$13,$14)
     RETURNING id`,
    [
      a.leaveId || null,
      a.date, a.period || '', a.dayOfWeek || '',
      a.originalTeacherId || '', a.originalTeacherName || '',
      a.subTeacherId || '', a.subTeacherName || '',
      a.subjectCode || '', a.subjectName || '',
      a.class || '', a.room || '',
      assignedBy, a.note || '',
    ]
  );
  return { status: 'success', message: 'บันทึกการจัดสอนแทนสำเร็จ', id: rows[0].id };
}

// Only the teacher actually assigned to cover the slot may confirm it.
async function confirmSubstitute([subId], user) {
  const { rowCount } = await query(
    isAdmin(user)
      ? `UPDATE substitute_assignments SET status='ยืนยันแล้ว' WHERE id=$1`
      : `UPDATE substitute_assignments SET status='ยืนยันแล้ว' WHERE id=$1 AND LOWER(sub_teacher_id)=LOWER($2)`,
    isAdmin(user) ? [subId] : [subId, String(user?.id || '')]
  );
  if (rowCount === 0) throw new Error('ไม่มีสิทธิ์ยืนยันการสอนแทนนี้');
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function reviewLeave([leaveId, status, comment], user) {
  await _setLeaveStatus(leaveId, status === LEAVE_APPROVED ? LEAVE_APPROVED : LEAVE_REJECTED, comment, user);
  return { status: 'success', message: 'บันทึกการพิจารณาสำเร็จ' };
}

// ครูที่ติดคาบอยู่แล้วต้องจัดไม่ได้ — เดิม UPDATE ตรง ๆ เลยจัดซ้อนได้เงียบ ๆ
// (getAvailableSubstitutes กรองให้บนหน้าจอแล้ว แต่ assignmentId/subTeacherId มาจาก client)
async function _assertSubstituteFree(assignmentId, subTeacherId) {
  const { rows: aRows } = await query(
    `SELECT date::text AS date, period, day_of_week, original_teacher_id
       FROM substitute_assignments WHERE id=$1`, [assignmentId]
  );
  if (!aRows.length) throw new Error('ไม่พบคาบสอนแทนนี้');
  const a = aRows[0];
  if (String(a.original_teacher_id) === String(subTeacherId)) {
    throw new Error('ครูคนนี้คือครูเจ้าของคาบ จัดให้สอนแทนตัวเองไม่ได้');
  }

  const { rows: setting } = await query(
    `SELECT value1, value2 FROM system_settings WHERE key='Active' AND subkey='Term' LIMIT 1`
  );
  const term = setting[0] ? setting[0].value1 : '1';
  const year = setting[0] ? setting[0].value2 : '2569';

  const { rows: own } = await query(
    `SELECT subject_code FROM timetable
      WHERE teacher_id=$1 AND day=$2 AND period=$3 AND term=$4 AND year=$5 LIMIT 1`,
    [subTeacherId, a.day_of_week || '', String(a.period), term, year]
  );
  if (own.length) throw new Error(`ครูคนนี้มีคาบสอนของตัวเองอยู่แล้ว (${own[0].subject_code}) คาบ ${a.period}`);

  const { rows: dup } = await query(
    `SELECT 1 FROM substitute_assignments
      WHERE date=$1 AND period=$2 AND sub_teacher_id=$3 AND status<>'ยกเลิก' AND id<>$4 LIMIT 1`,
    [a.date, String(a.period), subTeacherId, assignmentId]
  );
  if (dup.length) throw new Error(`ครูคนนี้ถูกจัดสอนแทนคาบ ${a.period} ของวันนี้ไปแล้ว`);
}

async function assignSubstitute([assignmentId, subTeacherId, note, /* assignedByName — ignored, JWT user.id used instead */], user) {
  if (!subTeacherId) throw new Error('ยังไม่ได้เลือกครูสอนแทน');
  await _assertSubstituteFree(assignmentId, subTeacherId);
  const { rows } = await query(`SELECT full_name FROM users WHERE username=$1`, [subTeacherId]);
  const subTeacherName = rows[0] ? rows[0].full_name : '';
  await query(
    `UPDATE substitute_assignments
     SET sub_teacher_id=$1, sub_teacher_name=$2, status='จัดแล้ว',
         assigned_by=$3, note=$4, assigned_at=NOW()
     WHERE id=$5`,
    [subTeacherId, subTeacherName, String(user?.id || ''), note || '', assignmentId]
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

// Throws unless the JWT user owns this leave record (admin bypasses).
async function _assertOwnsLeave(user, leaveId) {
  if (isAdmin(user)) return;
  const { rows } = await query(
    `SELECT 1 FROM leave_records WHERE id=$1 AND LOWER(teacher_id)=LOWER($2)`,
    [leaveId, String(user?.id || '')]
  );
  if (rows.length === 0) throw new Error('ไม่มีสิทธิ์แก้ไขใบลานี้');
}

async function updateLeave([leaveId, data], user) {
  await _assertOwnsLeave(user, leaveId);
  const d = data || {};
  await query(
    `UPDATE leave_records SET type=$1, start_date=$2, end_date=$3, days=$4, reason=$5 WHERE id=$6`,
    [d.type || 'ลาป่วย', d.startDate, d.endDate, parseFloat(d.days) || 1, d.reason || '', leaveId]
  );
  return { status: 'success', message: 'แก้ไขสำเร็จ' };
}

// ลบใบลาแล้วคาบสอนแทนที่ผูกอยู่ต้องไม่ค้าง — FK ไม่มี ON DELETE ตอนแรก DELETE เลยพังทั้งคำสั่ง
// คาบที่ยังไม่ได้จัด = ทิ้งได้เลย, คาบที่จัดครูไปแล้ว = ตั้งเป็น 'ยกเลิก' ไม่ลบ
// เพราะครูสอนแทนอาจรู้ตัวแล้ว ต้องเห็นว่าถูกยกเลิกในแท็บ "ยกเลิก"
async function deleteLeave([leaveId], user) {
  await _assertOwnsLeave(user, leaveId);
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM substitute_assignments WHERE leave_id=$1 AND status='รอจัด'`, [leaveId]);
    const { rowCount: cancelled } = await client.query(
      `UPDATE substitute_assignments SET status='ยกเลิก', leave_id=NULL WHERE leave_id=$1`, [leaveId]
    );
    await client.query(`DELETE FROM leave_records WHERE id=$1`, [leaveId]);
    await client.query('COMMIT');
    return {
      status: 'success',
      message: cancelled ? `ลบสำเร็จ (ยกเลิกคาบสอนแทนที่จัดไว้แล้ว ${cancelled} คาบ)` : 'ลบสำเร็จ',
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function manualCreateAffected([teacherId, startDate, endDate, leaveId]) {
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

  // Collect all (date, period, timetable-row) candidates first
  const candidates = [];
  const start = new Date(startDate);
  const end   = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayName = DAYS[d.getDay()];
    const dateStr = d.toISOString().slice(0, 10);
    for (const tt of timetable.filter(t => t.day === dayName)) {
      candidates.push({ dateStr, period: tt.period, dayName, tt });
    }
  }
  if (!candidates.length) return { status: 'success', message: 'สร้าง 0 คาบ', created: 0 };

  // Batch-check which (date, period) already exist
  const dates   = candidates.map(c => c.dateStr);
  const periods = candidates.map(c => c.period);
  const { rows: existing } = await query(
    `SELECT date::text, period FROM substitute_assignments
     WHERE original_teacher_id=$1 AND date=ANY($2::date[]) AND period=ANY($3)`,
    [teacherId, [...new Set(dates)], [...new Set(periods)]]
  );
  const existSet = new Set(existing.map(r => `${r.date}|${r.period}`));

  // Batch insert missing ones
  const toInsert = candidates.filter(c => !existSet.has(`${c.dateStr}|${c.period}`));
  if (!toInsert.length) return { status: 'success', message: 'สร้าง 0 คาบ', created: 0 };

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { dateStr, period, dayName, tt } of toInsert) {
      // leave_id ต้องผูกไว้ ไม่งั้นหน้าจัดสอนแทนไม่รู้ว่าครูลาอะไร (leaveType ว่างทุกแถว)
      await client.query(
        `INSERT INTO substitute_assignments
         (leave_id,date,period,day_of_week,original_teacher_id,original_teacher_name,
          subject_code,subject_name,class,room,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'รอจัด')`,
        [leaveId || null, dateStr, period, dayName, teacherId, tt.teacher_name || '',
         tt.subject_code, tt.subject_name, tt.class_name, tt.room]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { status: 'success', message: `สร้าง ${toInsert.length} คาบ`, created: toInsert.length };
}

module.exports = {
  saveLeaveRequest, approveLeave, rejectLeave, reviewLeave,
  updateLeave, deleteLeave,
  assignSubstitute, unassignSubstitute, manualCreateAffected,
  saveSubstituteAssignment, confirmSubstitute,
};
