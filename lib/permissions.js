'use strict';
const { query } = require('./db');
const cache = require('./cache');

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

// Executive = ผอ./รอง — อ่านได้ทั้งโรงเรียน แก้ไม่ได้ (docs/adr/0001)
function adminOrExecutive(user) {
  const r = role(user);
  if (r !== 'ADMIN' && r !== 'EXECUTIVE') throw new Error('สงวนสิทธิ์เฉพาะผู้ดูแลระบบหรือผู้บริหาร');
}

function _normalize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');
}

// Throws if JWT user is not Admin and doesn't teach this subject+class.
// className may be null to skip the class-level check (subject-only).
// Mirrors GAS verifyTeacherPermission logic: HR always passes, CLUB_ checks club_advisors.
// `opts.date` (+ optional `opts.period`) opens a substitute-teacher path: a teacher
// assigned to cover that exact slot may write to it. Callers that can't name a date
// (score writes, subject config) get no substitute path at all — covering one period
// is not ownership of the course.
async function verifyTeacherOwnsSubject(user, subjectCode, className, term, year, opts) {
  if (isAdmin(user)) return;
  const teacherId = String(user?.id || '').trim().toLowerCase();
  const code = String(subjectCode || '').trim();

  if (code.toUpperCase() === 'HR') return;

  if (code.startsWith('CLUB')) {
    // timetable returns 'CLUB_<clubId>' but club_advisors stores plain clubId
    const clubId = code.startsWith('CLUB_') ? code.slice(5) : code;
    const { rows } = await query(
      `SELECT 1 FROM club_advisors WHERE club_id=$1 AND LOWER(teacher_id)=$2`,
      [clubId, teacherId]
    );
    if (rows.length === 0) throw new Error('ไม่มีสิทธิ์จัดการชุมนุมนี้');
    return;
  }

  const cacheKey = `tt_own_${teacherId}_${code}_${term}_${year}`;
  let rows = cache.get(cacheKey);
  if (!rows) {
    ({ rows } = await query(
      `SELECT level, room FROM timetable
       WHERE LOWER(teacher_id)=$1 AND subject_code=$2 AND term=$3 AND year=$4`,
      [teacherId, subjectCode, String(term), String(year)]
    ));
    cache.set(cacheKey, rows, 300);
  }
  if (rows.length === 0) {
    if (await _hasSubstituteSlot(teacherId, subjectCode, className, opts)) return;
    throw new Error('ไม่มีสิทธิ์จัดการรายวิชานี้');
  }
  if (className) {
    const normClass = _normalize(className);
    const match = rows.some(r => _normalize(`${r.level}/${r.room}`) === normClass);
    if (!match) {
      if (await _hasSubstituteSlot(teacherId, subjectCode, className, opts)) return;
      throw new Error('ไม่มีสิทธิ์จัดการห้องเรียนนี้');
    }
  }
}

// A substitute teacher isn't in `timetable` for the subject they cover, so the
// timetable check above rejects them. Matched on the exact assigned slot.
async function _hasSubstituteSlot(teacherId, subjectCode, className, opts) {
  const date = opts && opts.date;
  if (!date) return false;
  const params = [teacherId, String(subjectCode || '').trim(), date];
  let sql = `SELECT class FROM substitute_assignments
             WHERE LOWER(sub_teacher_id)=$1 AND subject_code=$2 AND date=$3
               AND status IN ('จัดแล้ว', 'ยืนยันแล้ว')`;
  if (opts.period !== undefined && opts.period !== null && opts.period !== '') {
    params.push(String(opts.period));
    sql += ` AND period=$4`;
  }
  const { rows } = await query(sql, params);
  if (rows.length === 0) return false;
  if (!className) return true;
  const normClass = _normalize(className);
  return rows.some(r => _normalize(r.class) === normClass);
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

// Throws if any of the given morning_activity row ids (integers) don't belong to JWT user.
// HR passes verifyTeacherOwnsSubject unconditionally, so homeroom writes need this
// row-level check of their own — otherwise any teacher can edit any homeroom record.
async function verifyMorningBatchOwner(user, rowIds) {
  if (isAdmin(user) || rowIds.length === 0) return;
  const teacherId = String(user?.id || '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT id FROM morning_activity WHERE id = ANY($1) AND LOWER(teacher_id) != $2`,
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

/**
 * ตัวตนของนักเรียนที่ endpoint จะไปดึงข้อมูลให้
 *
 * นักเรียนดูได้เฉพาะของตัวเอง — รหัสที่ส่งมาใน payload ถูกทิ้ง ใช้ตัวใน JWT เสมอ
 * ครูและผู้ดูแลดูของนักเรียนคนไหนก็ได้ เพราะเป็นหน้าที่ (เช็คคะแนน ดูสมุดเงินออม)
 *
 * ⚠️ ทุก endpoint ที่รับ studentId จาก payload ต้องผ่านตัวนี้ ไม่งั้นนักเรียนคนหนึ่ง
 *    เปลี่ยนตัวเลขใน request แล้วอ่านเกรดหรือยอดเงินของเพื่อนได้ทันที
 */
function resolveStudentId(user, payloadStudentId) {
  const self = String(user?.id || '');
  return role(user) === 'STUDENT' ? self : (String(payloadStudentId || '') || self);
}

module.exports = {
  adminOrExecutive,
  adminOnly,
  resolveStudentId,
  teacherOrAdmin,
  isAdmin,
  normalizeKey: _normalize,
  resolveTeacherId,
  verifyTeacherOwnsSubject,
  verifySessionOwner,
  verifyAttendanceBatchOwner,
  verifyMorningBatchOwner,
  verifyLessonRecordOwner,
};
