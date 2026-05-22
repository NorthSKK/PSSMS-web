'use strict';
const { query } = require('./db');

function role(user) {
  return String(user?.role || '').trim().toUpperCase();
}

function isAdmin(user) {
  return role(user) === 'ADMIN';
}

function adminOnly(user) {
  if (!isAdmin(user)) throw new Error('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ');
}

function teacherOrAdmin(user) {
  const r = role(user);
  if (r !== 'ADMIN' && r !== 'TEACHER') throw new Error('สงวนสิทธิ์เฉพาะครูหรือผู้ดูแลระบบ');
}

function _normalize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');
}

// Throws if JWT user is not Admin and doesn't teach this subject+class.
// className may be null to skip the class-level check (subject-only).
// Mirrors GAS verifyTeacherPermission logic: HR always passes, CLUB_ checks club_advisors.
async function verifyTeacherOwnsSubject(user, subjectCode, className, term, year) {
  if (isAdmin(user)) return;
  const teacherId = String(user?.id || '').trim().toLowerCase();
  const code = String(subjectCode || '').trim();

  if (code.toUpperCase() === 'HR') return;

  if (code.startsWith('CLUB')) {
    const { rows } = await query(
      `SELECT 1 FROM club_advisors WHERE club_id=$1 AND LOWER(teacher_id)=$2`,
      [code, teacherId]
    );
    if (rows.length === 0) throw new Error('ไม่มีสิทธิ์จัดการชุมนุมนี้');
    return;
  }

  const { rows } = await query(
    `SELECT level, room FROM timetable
     WHERE LOWER(teacher_id)=$1 AND subject_code=$2 AND term=$3 AND year=$4`,
    [teacherId, subjectCode, String(term), String(year)]
  );
  if (rows.length === 0) throw new Error('ไม่มีสิทธิ์จัดการรายวิชานี้');
  if (className) {
    const normClass = _normalize(className);
    const match = rows.some(r => _normalize(`${r.level}/${r.room}`) === normClass);
    if (!match) throw new Error('ไม่มีสิทธิ์จัดการห้องเรียนนี้');
  }
}

// Throws if JWT user doesn't own the given attendance session.
async function verifySessionOwner(user, sessionId) {
  if (isAdmin(user)) return;
  const teacherId = String(user?.id || '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT 1 FROM attendance WHERE session_id=$1 AND LOWER(teacher_id)=$2 LIMIT 1`,
    [sessionId, teacherId]
  );
  if (rows.length === 0) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลการเช็คชื่อนี้');
}

// Throws if any of the given attendance row ids (integers) don't belong to JWT user.
async function verifyAttendanceBatchOwner(user, rowIds) {
  if (isAdmin(user) || rowIds.length === 0) return;
  const teacherId = String(user?.id || '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT id FROM attendance WHERE id = ANY($1) AND LOWER(teacher_id) != $2`,
    [rowIds, teacherId]
  );
  if (rows.length > 0) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
}

// Throws if JWT user doesn't own the detailed_lesson_records row with given id.
async function verifyLessonRecordOwner(user, recordId) {
  if (isAdmin(user)) return;
  const teacherId = String(user?.id || '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT 1 FROM detailed_lesson_records WHERE id=$1 AND LOWER(teacher_id)=$2`,
    [recordId, teacherId]
  );
  if (rows.length === 0) throw new Error('ไม่มีสิทธิ์แก้ไขบันทึกนี้');
}

// Admin may override teacherId (e.g. assigning a subject to a specific teacher);
// non-admin always uses their own JWT identity.
function resolveTeacherId(user, payloadTeacherId) {
  return isAdmin(user) ? (payloadTeacherId || String(user?.id || '')) : String(user?.id || '');
}

module.exports = {
  adminOnly,
  teacherOrAdmin,
  isAdmin,
  resolveTeacherId,
  verifyTeacherOwnsSubject,
  verifySessionOwner,
  verifyAttendanceBatchOwner,
  verifyLessonRecordOwner,
};
