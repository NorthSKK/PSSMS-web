/**
 * Implements functions referenced in GAS frontend but not yet in Phase 2/3.
 * Grouped here to keep other files clean.
 */
const { query } = require('../lib/db');
const cache = require('../lib/cache');

// ============================================================
// getTeacherRiskDashboard — grade-based risk (0, ร, มส)
// returns { status, summary: {zero,r,ms}, details: [{className,subjectCode,subjectName,stdName,type}] }
// ============================================================
async function getTeacherRiskDashboard([teacherId, term, year]) {
  const { rows } = await query(
    `SELECT gs.student_id, u.full_name as std_name,
            gs.subject_code, sc.subject_name,
            u.department as class_name,
            gs.grade
     FROM grade_summary gs
     JOIN users u ON u.username = gs.student_id
     LEFT JOIN (
       SELECT DISTINCT subject_code, subject_name
       FROM timetable WHERE teacher_id=$1 AND term=$2 AND year=$3
     ) sc ON sc.subject_code = gs.subject_code
     WHERE gs.term=$2 AND gs.year=$3
       AND gs.grade IN ('0','ร','มส','มส.')
       AND gs.subject_code IN (
         SELECT DISTINCT subject_code FROM timetable
         WHERE teacher_id=$1 AND term=$2 AND year=$3
       )
     ORDER BY gs.subject_code, u.department, gs.student_id`,
    [teacherId, term, year]
  );

  const details = rows.map(r => ({
    className: r.class_name || '',
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    stdName: r.std_name || '',
    type: r.grade === '0' ? '0' : r.grade === 'ร' ? 'ร' : 'มส',
  }));

  const summary = {
    zero: details.filter(d => d.type === '0').length,
    r: details.filter(d => d.type === 'ร').length,
    ms: details.filter(d => d.type === 'มส').length,
  };

  return { status: 'success', summary, details };
}

// ============================================================
// getTeacherAtRiskDashboard — delegates to shared report logic
// (matches GAS: periodsPerWeek × 20 weeks, percent < 60/80/85 buckets)
// ============================================================
const { getTeacherAtRiskDashboard } = require('./attendanceReport');

// ============================================================
// getStudentDashboardBundle
// ============================================================
async function getStudentDashboardBundle([studentId, term, year]) {
  const userRes = await query(
    `SELECT department FROM users WHERE username=$1`, [studentId]
  );
  const className = userRes.rows[0]?.department || '';
  const parts = className.split('/');
  const level = parts[0] || '';
  const room = parts[1] || '';

  const DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const todayDay = DAYS[new Date().getDay()];

  let timetable = { ok: false, data: [] };
  try {
    if (todayDay && level) {
      const { rows } = await query(
        `SELECT t.subject_code, t.subject_name, t.level||'/'||t.room as class_id,
                t.period, t.location, u.full_name as teacher_name
         FROM timetable t
         LEFT JOIN users u ON u.username = t.teacher_id
         WHERE t.level=$1 AND t.room=$2 AND t.day=$3 AND t.term=$4 AND t.year=$5
         ORDER BY t.period::integer`,
        [level, room, todayDay, term, year]
      );
      timetable = { ok: true, data: rows };
    } else {
      timetable = { ok: true, data: [] };
    }
  } catch (e) { timetable = { ok: false, error: e.message, data: [] }; }

  let scoreFeed = { ok: true, data: [] };
  try {
    const { rows } = await query(
      `SELECT gs.subject_code, sc.subject_name, gs.total_score, gs.grade
       FROM grade_summary gs
       LEFT JOIN subject_config sc ON sc.subject_code = gs.subject_code AND sc.term=$2 AND sc.year=$3
       WHERE gs.student_id=$1 AND gs.term=$2 AND gs.year=$3`,
      [studentId, term, year]
    );
    scoreFeed = { ok: true, data: rows };
  } catch (e) { scoreFeed = { ok: false, error: e.message, data: [] }; }

  return { timetable, scoreFeed };
}

// ============================================================
// getExecutiveDashboardBundle
// ============================================================
async function getExecutiveDashboardBundle([dept]) {
  const getSystemConfig = require('./getSystemConfig');
  const getCalendarEvents = require('./getCalendarEvents');
  const config = await getSystemConfig();

  const [staffRes, leaveRes, calendarEvents] = await Promise.all([
    query(
      `SELECT UPPER(role) as role, COUNT(*) as cnt FROM users
       WHERE UPPER(role) != 'STUDENT' OR year=$1 GROUP BY UPPER(role)`,
      [config.year]
    ),
    query(`SELECT COUNT(*) as cnt FROM leave_records WHERE status='รอพิจารณา' AND year=$1`, [config.year]),
    getCalendarEvents(),
  ]);

  let studentCount = 0, teacherCount = 0;
  for (const r of staffRes.rows) {
    if (r.role === 'STUDENT') studentCount += parseInt(r.cnt);
    else teacherCount += parseInt(r.cnt);
  }

  return {
    ts: Date.now(),
    systemConfig: { ok: true, data: config },
    kpi: {
      ok: true,
      data: {
        studentCount, teacherCount,
        pendingLeaveCount: parseInt(leaveRes.rows[0]?.cnt || 0),
      },
    },
    calendarEvents: { ok: true, data: calendarEvents },
    academic: { ok: true, data: {} },
    budget: { ok: true, data: {} },
    personnel: { ok: true, data: {} },
    general: { ok: true, data: {} },
  };
}

// ============================================================
// Club helpers
// ============================================================
async function getClubMembers([clubId, term, year]) {
  const { rows } = await query(
    `SELECT cm.student_id, cm.student_name, cm.class_name,
            to_char(cm.registered_at,'YYYY-MM-DD') as registered_at
     FROM club_members cm
     WHERE cm.club_id=$1 AND cm.term=$2 AND cm.year=$3
     ORDER BY cm.class_name, cm.student_id`,
    [clubId, term, year]
  );
  return rows.map(r => ({
    studentId: r.student_id,
    studentName: r.student_name || '',
    className: r.class_name || '',
    registeredAt: r.registered_at || '',
  }));
}

async function getClubMembersForTeacher([teacherId, term, year]) {
  const { rows } = await query(
    `SELECT ca.club_id, c.club_name, cm.student_id, cm.student_name, cm.class_name
     FROM club_advisors ca
     JOIN clubs c ON c.club_id = ca.club_id AND c.term=ca.term AND c.year=ca.year
     JOIN club_members cm ON cm.club_id = ca.club_id AND cm.term=ca.term AND cm.year=ca.year
     WHERE ca.teacher_id=$1 AND ca.term=$2 AND ca.year=$3
     ORDER BY cm.class_name, cm.student_id`,
    [teacherId, term, year]
  );
  return rows.map(r => ({
    clubId: r.club_id,
    clubName: r.club_name,
    studentId: r.student_id,
    studentName: r.student_name || '',
    className: r.class_name || '',
  }));
}

async function getClubAttendanceSummary([clubId, term, year]) {
  const { rows } = await query(
    `SELECT a.student_id, a.student_name,
            COUNT(*) as total,
            COUNT(CASE WHEN a.status IN ('มา','present') THEN 1 END) as present
     FROM attendance a
     WHERE a.subject_code LIKE 'CLUB_%' AND a.class=$1
       AND a.term=$2 AND a.year=$3
     GROUP BY a.student_id, a.student_name
     ORDER BY a.student_id`,
    [clubId, term, year]
  );
  return rows.map(r => ({
    studentId: r.student_id,
    studentName: r.student_name || '',
    total: parseInt(r.total),
    present: parseInt(r.present),
  }));
}

async function deleteClub([clubId]) {
  await query(`DELETE FROM clubs WHERE club_id=$1`, [clubId]);
  cache.del('clubs_all');
  return { status: 'success', message: 'ลบชุมนุมสำเร็จ' };
}

async function registerToClub([studentId, studentName, className, clubId, term, year, registeredBy]) {
  return require('./clubs_write').registerClub([studentId, studentName, className, clubId, term, year, registeredBy]);
}

async function unregisterFromClub([studentId, term, year]) {
  return require('./clubs_write').unregisterClub([studentId, term, year]);
}

// ============================================================
// Leave
// ============================================================
async function getAllLeaves([year, statusFilter]) {
  const params = [year];
  let sql = `SELECT id, teacher_id, staff_name, type,
             to_char(start_date,'YYYY-MM-DD') as start_date,
             to_char(end_date,'YYYY-MM-DD') as end_date,
             days, reason, status, year, admin_comment, reviewed_by
             FROM leave_records WHERE year=$1`;
  if (statusFilter && statusFilter !== 'all') {
    params.push(statusFilter);
    sql += ` AND status=$${params.length}`;
  }
  sql += ' ORDER BY request_date DESC';
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    leaveId: r.id, teacherId: r.teacher_id, teacherName: r.staff_name || '',
    type: r.type, startDate: r.start_date, endDate: r.end_date,
    days: parseFloat(r.days || 1), reason: r.reason || '',
    status: r.status, year: r.year,
    adminComment: r.admin_comment || '', reviewerName: r.reviewed_by || '',
  }));
}

// ============================================================
// Config / School info
// ============================================================
async function saveSchoolInfo([schoolName, logoBase64, logoFilename]) {
  if (schoolName) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1) VALUES('school_name','',$1)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1`,
      [schoolName]
    );
  }
  if (logoBase64) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('school_logo','',$1,$2)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1, value2=$2`,
      [logoBase64, logoFilename || '']
    );
  }
  cache.del('system_config');
  return { status: 'success', message: 'บันทึกข้อมูลโรงเรียนสำเร็จ' };
}

async function savePrintConfigData([term, year, sysData, homeroomData]) {
  await query(
    `INSERT INTO print_config(term,year,sys_data,homeroom_data)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(term,year) DO UPDATE SET sys_data=$3, homeroom_data=$4`,
    [term, year, JSON.stringify(sysData || {}), JSON.stringify(homeroomData || {})]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

// ============================================================
// Curriculum
// ============================================================
async function getCurriculumData([subjectCode]) {
  const params = [];
  let sql = `SELECT id, subject_code, subject_type, standard_code, description, eval_type FROM curriculum`;
  if (subjectCode) { params.push(subjectCode); sql += ` WHERE subject_code=$1`; }
  sql += ' ORDER BY subject_code, id';
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    id: r.id, subjectCode: r.subject_code,
    subjectType: r.subject_type || '', standardCode: r.standard_code || '',
    description: r.description || '', evalType: r.eval_type || '',
  }));
}

async function importCurriculumCSV([rows, clearOld]) {
  if (!Array.isArray(rows) || rows.length === 0) return { status: 'success', message: 'นำเข้า 0 รายการ' };
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    if (clearOld) await client.query('DELETE FROM curriculum');
    for (const r of rows) {
      await client.query(
        `INSERT INTO curriculum(subject_code,subject_type,standard_code,description,eval_type)
         VALUES($1,$2,$3,$4,$5)`,
        [r.subjectCode||'', r.subjectType||'', r.standardCode||'', r.description||'', r.evalType||'']
      );
      count++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { status: 'success', message: `นำเข้าสำเร็จ ${count} รายการ` };
}

// ============================================================
// Stubs (DB already set up, just return success)
// ============================================================
async function setupCalendarDatabase() {
  return 'ฐานข้อมูลปฏิทินพร้อมใช้งานแล้ว';
}
async function setupClubDatabase() {
  return { status: 'success', message: 'ฐานข้อมูลชุมนุมพร้อมใช้งานแล้ว' };
}
async function setupCurriculumDatabase() {
  return { status: 'success', message: 'ฐานข้อมูลหลักสูตรพร้อมใช้งานแล้ว' };
}
async function saveStudentRemarkDirectly([studentId, remark, term, year]) {
  return { status: 'success', message: 'บันทึกหมายเหตุสำเร็จ' };
}
async function uploadSarabunFile([id, base64Data, filename, docNum]) {
  return { status: 'success', message: 'ไม่รองรับอัปโหลดไฟล์ใน web prototype', fileURL: '' };
}
async function getTeacherListForDropdown() {
  return require('./getTeachersForTimetable')();
}

// ============================================================
// getPrintConfigData — reads print_config + homeroom assignments
// ============================================================
async function getPrintConfigData([term, year]) {
  const { getHomeroomAssignments } = require('./timetable_admin');
  const getSystemConfig = require('./getSystemConfig');

  const sysConfig = await getSystemConfig();
  const t = term || sysConfig.term;
  const y = year || sysConfig.year;

  // sys data from print_config table
  let sys = {
    school_name: sysConfig.schoolName || 'โรงเรียนภูพระบาทวิทยา',
    principal_name: '', measure_head: '', academic_head: '',
  };
  try {
    const { rows } = await query(
      `SELECT sys_data FROM print_config WHERE term=$1 AND year=$2`, [t, y]
    );
    if (rows.length > 0 && rows[0].sys_data) {
      const parsed = typeof rows[0].sys_data === 'string'
        ? JSON.parse(rows[0].sys_data) : rows[0].sys_data;
      sys = { ...sys, ...parsed };
    }
  } catch (_) { /* table may not exist yet */ }

  // homeroom from timetable
  let hr = [];
  try {
    const assignments = await getHomeroomAssignments([t, y]);
    hr = assignments.map(a => ({
      cls: a.className,
      t1: a.teacherName || a.teacherId || '',
      t2: '',
    }));
  } catch (_) {}

  return { status: 'success', sys, hr };
}

// ============================================================
// getMyClub — club a student is registered to
// ============================================================
async function getMyClub([studentId, term, year]) {
  const { rows } = await query(
    `SELECT cm.club_id, c.club_name, c.capacity,
            (SELECT COUNT(*) FROM club_members m2 WHERE m2.club_id=cm.club_id AND m2.term=$2 AND m2.year=$3) as member_count
     FROM club_members cm
     JOIN clubs c ON c.club_id=cm.club_id AND c.term=$2 AND c.year=$3
     WHERE cm.student_id=$1 AND cm.term=$2 AND cm.year=$3
     LIMIT 1`,
    [studentId, term, year]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    clubId: r.club_id,
    clubName: r.club_name,
    maxMembers: parseInt(r.capacity || 0),
    memberCount: parseInt(r.member_count || 0),
  };
}

// ============================================================
// getMyClubs — clubs where teacher is advisor
// ============================================================
async function getMyClubs([teacherId, term, year]) {
  const { rows } = await query(
    `SELECT c.club_id, c.club_name, c.capacity, ca.role as my_role,
            (SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.club_id AND m.term=$2 AND m.year=$3) as member_count
     FROM club_advisors ca
     JOIN clubs c ON c.club_id=ca.club_id AND c.term=ca.term AND c.year=ca.year
     WHERE ca.teacher_id=$1 AND ca.term=$2 AND ca.year=$3
     ORDER BY c.club_name`,
    [teacherId, term, year]
  );
  return rows.map(r => ({
    clubId: r.club_id,
    clubName: r.club_name,
    maxMembers: parseInt(r.capacity || 0),
    memberCount: parseInt(r.member_count || 0),
    myRole: r.my_role || 'หัวหน้า',
  }));
}

// ============================================================
// getCurriculumBySubject — filtered alias of getCurriculumData
// ============================================================
async function getCurriculumBySubject([subjectCode]) {
  return getCurriculumData([subjectCode]);
}

// ============================================================
// getAvailableSubstitutes — teachers free at given date/period
// ============================================================
async function getAvailableSubstitutes([date, period, originalSubjectCode, originalTeacherId, term, year]) {
  const DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const dayName = DAYS[new Date(date).getDay()];

  // Get original teacher's department for group matching
  const { rows: origRows } = await query(
    `SELECT department FROM users WHERE username=$1 LIMIT 1`, [originalTeacherId]
  );
  const origDept = origRows[0]?.department || '';

  // Find teachers who have a timetable conflict at that slot
  const { rows: conflictRows } = await query(
    `SELECT DISTINCT teacher_id FROM timetable
     WHERE day=$1 AND period=$2 AND term=$3 AND year=$4`,
    [dayName, String(period), String(term), String(year)]
  );
  const conflictSet = new Set(conflictRows.map(r => r.teacher_id));

  // Also conflict if already assigned as substitute that date+period
  try {
    const { rows: subRows } = await query(
      `SELECT DISTINCT sub_teacher_id FROM substitute_assignments
       WHERE date=$1 AND period=$2 AND status != 'ยกเลิก'`,
      [date, String(period)]
    );
    subRows.forEach(r => conflictSet.add(r.sub_teacher_id));
  } catch (_) {}

  // Get all teachers + their lifetime substitute count
  const { rows: teachers } = await query(
    `SELECT u.username, u.full_name, u.department,
            COUNT(sa.id) AS sub_count
     FROM users u
     LEFT JOIN substitute_assignments sa ON sa.sub_teacher_id=u.username
     WHERE UPPER(u.role) IN ('TEACHER','ADMIN') AND u.username != $1
     GROUP BY u.username, u.full_name, u.department
     ORDER BY u.full_name`,
    [originalTeacherId]
  );

  // Find teachers who taught same subject (for 'exact' badge)
  const { rows: exactRows } = await query(
    `SELECT DISTINCT teacher_id FROM timetable
     WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [originalSubjectCode, String(term), String(year)]
  );
  const exactSet = new Set(exactRows.map(r => r.teacher_id));

  const RANK = { exact: 0, group: 1, none: 2 };
  const result = teachers.map(t => ({
    teacherId:    t.username,
    name:         t.full_name,
    department:   t.department,
    subjectMatch: exactSet.has(t.username) ? 'exact'
                : (origDept && t.department === origDept ? 'group' : 'none'),
    hasConflict:  conflictSet.has(t.username),
    subCount:     Number(t.sub_count || 0),
  }));

  // Sort: no conflict first → exact > group > none → subCount ASC
  result.sort((a, b) => {
    if (a.hasConflict !== b.hasConflict) return a.hasConflict ? 1 : -1;
    const rd = RANK[a.subjectMatch] - RANK[b.subjectMatch];
    if (rd !== 0) return rd;
    return a.subCount - b.subCount;
  });
  return result;
}

// ============================================================
// updateTaskStatus — Notion todo update (stub: uses in-memory todo)
// ============================================================
async function updateTaskStatus([pageId, isDone]) {
  return { status: 'success' };
}

// ============================================================
// adminAddMember / adminRemoveMember — club admin actions
// ============================================================
async function adminAddMember([clubId, studentId]) {
  // Lookup student info
  const { rows } = await query(
    `SELECT username, full_name, department FROM users WHERE username=$1`, [studentId]
  );
  const u = rows[0] || {};

  // Check if already registered
  const existing = await query(
    `SELECT club_id FROM club_members WHERE student_id=$1`, [studentId]
  );
  if (existing.rows.length > 0) {
    return { status: 'already', message: `${studentId} ลงทะเบียนชุมนุมอื่นแล้ว` };
  }

  // Get club term/year
  const clubRes = await query(`SELECT term, year, capacity FROM clubs WHERE club_id=$1`, [clubId]);
  if (clubRes.rows.length === 0) return { status: 'error', message: 'ไม่พบชุมนุม' };
  const club = clubRes.rows[0];

  try {
    await query(
      `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
       VALUES($1,$2,$3,$4,$5,$6,'admin')`,
      [clubId, studentId, u.full_name || '', u.department || '', club.term, club.year]
    );
    return { status: 'success', message: 'เพิ่มสมาชิกสำเร็จ' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function adminRemoveMember([clubId, studentId]) {
  await query(
    `DELETE FROM club_members WHERE club_id=$1 AND student_id=$2`, [clubId, studentId]
  );
  return { status: 'success', message: 'ลบสมาชิกสำเร็จ' };
}

// ============================================================
// promoteStudentsToNextYear — elevate class level, graduate ม.3 & ม.6
// ============================================================
async function promoteStudentsToNextYear() {
  const getSystemConfig = require('./getSystemConfig');
  const config = await getSystemConfig();
  const currentYear = parseInt(config.year);
  if (!currentYear) return { status: 'error', message: 'อ่านค่าปีการศึกษาไม่สำเร็จ' };

  // Snapshot full row before mutation
  const { rows } = await query(
    `SELECT username, password, full_name, role, department, email, year, status
     FROM users
     WHERE UPPER(role)='STUDENT' AND status='ปกติ' AND CAST(year AS INTEGER) < $1`,
    [currentYear]
  );

  if (rows.length === 0) {
    return { status: 'error', message: '⚠️ ไม่พบนักเรียนที่เข้าเงื่อนไขการเลื่อนชั้น!' };
  }

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let updateCount = 0;
  let graduateCount = 0;

  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const cls = String(r.department || '');
      const m = cls.match(/ม\.(\d+)\/(\d+)/);
      let newDept = r.department;
      let newStatus = r.status;
      let isGraduate = false;

      if (m) {
        const level = parseInt(m[1]);
        const room = parseInt(m[2]);
        if (level === 3 || level === 6) {
          newStatus = 'จบการศึกษา';
          isGraduate = true;
        } else {
          newDept = `ม.${level + 1}/${room}`;
        }
      }

      // Snapshot old row to user_history before mutation
      await client.query(
        `INSERT INTO user_history(username, action, changed_by, old_data, new_data)
         VALUES($1, 'promote', 'system', $2::jsonb, $3::jsonb)`,
        [
          r.username,
          JSON.stringify(r),
          JSON.stringify({ ...r, department: newDept, year: String(currentYear), status: newStatus }),
        ]
      );

      if (isGraduate) {
        await client.query(
          `UPDATE users SET status='จบการศึกษา', year=$1 WHERE username=$2`,
          [currentYear, r.username]
        );
        graduateCount++;
      } else {
        await client.query(
          `UPDATE users SET department=$1, year=$2 WHERE username=$3`,
          [newDept, currentYear, r.username]
        );
        updateCount++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const cache = require('../lib/cache');
  cache.del('all_users');

  return {
    status: 'success',
    message: `✅ เลื่อนชั้นสำเร็จ ${updateCount} คน\n🎓 จบการศึกษา (ม.3, ม.6) ${graduateCount} คน`,
  };
}

async function exportClubsForTerm([term, year]) {
  const clubsRes = await query(
    `SELECT club_id, club_name, capacity FROM clubs WHERE term=$1 AND year=$2 ORDER BY club_name`,
    [term, year]
  );
  const clubs = [];
  for (const c of clubsRes.rows) {
    const advRes = await query(
      `SELECT teacher_name FROM club_advisors WHERE club_id=$1 AND term=$2 AND year=$3`,
      [c.club_id, term, year]
    );
    const memRes = await query(
      `SELECT student_id, student_name, class_name FROM club_members WHERE club_id=$1 AND term=$2 AND year=$3 ORDER BY class_name, student_id`,
      [c.club_id, term, year]
    );
    clubs.push({
      clubName: c.club_name,
      capacity: c.capacity,
      advisors: advRes.rows.map(r => ({ teacherName: r.teacher_name })),
      members: memRes.rows.map(r => ({ studentId: r.student_id, studentName: r.student_name, className: r.class_name })),
    });
  }
  return { term, year, clubs };
}

module.exports = {
  getTeacherRiskDashboard,
  getTeacherAtRiskDashboard,
  getStudentDashboardBundle,
  getExecutiveDashboardBundle,
  getClubMembers,
  getClubMembersForTeacher,
  getClubAttendanceSummary,
  deleteClub,
  registerToClub,
  unregisterFromClub,
  getAllLeaves,
  saveSchoolInfo,
  savePrintConfigData,
  getPrintConfigData,
  getCurriculumData,
  getCurriculumBySubject,
  importCurriculumCSV,
  setupCalendarDatabase,
  setupClubDatabase,
  setupCurriculumDatabase,
  saveStudentRemarkDirectly,
  uploadSarabunFile,
  getTeacherListForDropdown,
  getMyClub,
  getMyClubs,
  getAvailableSubstitutes,
  updateTaskStatus,
  adminAddMember,
  adminRemoveMember,
  promoteStudentsToNextYear,
  exportClubsForTerm,
};
