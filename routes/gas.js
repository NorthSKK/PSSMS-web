const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { adminOnly, teacherOrAdmin, isAdmin, verifyTeacherOwnsSubject } = require('../lib/permissions');
const cache = require('../lib/cache');

// Functions that invalidate timetable-related caches on success
const TIMETABLE_WRITE_FNS = new Set([
  'updateTimetableRow', 'deleteTimetableRow', 'importTimetableCSV',
  'swapTimetableTeacher', 'setHomeroomTeacher', 'setAllHomeroomTeachers',
  'teacherUpdateTimetableRow',
]);
// Functions that invalidate student-list caches on success
const USER_WRITE_FNS = new Set([
  'addUser', 'editUser', 'deleteUser', 'importStudentCSV', 'importTeacherCSV',
  'promoteStudentsToNextYear',
]);

// Functions callable without a valid session token
const PUBLIC_FNS = new Set(['checkLogin', 'getSystemConfig']);

const ADMIN_ONLY = new Set([
  'addUser', 'editUser', 'deleteUser', 'importStudentCSV', 'importTeacherCSV',
  'saveSystemConfig', 'saveCalendarEvent', 'deleteCalendarEvent', 'importCalendarCSV',
  'updateTimetableRow', 'deleteTimetableRow', 'importTimetableCSV', 'swapTimetableTeacher',
  'setHomeroomTeacher', 'setAllHomeroomTeachers',
  'approveLeave', 'rejectLeave', 'assignSubstitute', 'unassignSubstitute', 'manualCreateAffected',
  'saveSchoolInfo', 'savePrintConfigData', 'importCurriculumCSV',
  'addCurriculumItem', 'updateCurriculumItem', 'deleteCurriculumItem',
  'setupCalendarDatabase', 'setupClubDatabase', 'setupCurriculumDatabase',
  'promoteStudentsToNextYear', 'deleteClub', 'adminAddMember', 'adminRemoveMember',
  'getAllUsers',
  'deleteSavingsTransaction', 'importSavingsCSV',
]);

const TEACHER_OR_ADMIN = new Set([
  'saveAttendanceBatch', 'saveLessonRecord', 'updateAttendanceStatus', 'updateAttendanceBatch',
  'saveMassiveAttendanceGrid', 'saveSubjectConfig', 'saveAllInOneScores', 'saveAllInOneWithConfig',
  'saveDetailedLessonRecord', 'updateDetailedLessonRecord', 'deleteDetailedLessonRecord',
  'saveMorningActivityBatch', 'createClub', 'updateClub', 'teacherUpdateTimetableRow',
  'saveStudentRemarkDirectly', 'saveLeaveRequest', 'updateLeave', 'deleteLeave', 'reviewLeave',
  'saveSubstituteAssignment', 'confirmSubstitute', 'saveBudget', 'saveSarabun', 'deleteSarabun',
  'requestSarabunNumber', 'updateTaskStatus', 'uploadSarabunFile',
  'saveSavingsTransaction',
]);

const leaveBundle = require('../functions/getLeaveBundle');
const attendance = require('../functions/attendance');
const students = require('../functions/students');
const usersWrite = require('../functions/users');
const timetableAdmin = require('../functions/timetable_admin');
const config = require('../functions/config');
const lessonRecords = require('../functions/lesson_records');
const scores = require('../functions/scores');
const morning = require('../functions/morning');
const leaveWrite = require('../functions/leave');
const clubsWrite = require('../functions/clubs_write');
const sarabun = require('../functions/sarabun');
const budget = require('../functions/budget');
const missing = require('../functions/missing');
const pp5 = require('../functions/generatePP5Template');
const savings = require('../functions/savings');

const handlers = {
  // Auth
  checkLogin:                      require('../functions/checkLogin'),
  getSystemConfig:                 require('../functions/getSystemConfig'),
  getAvailableTerms:               async () => {
    const { query } = require('../lib/db');
    const { rows } = await query(
      `SELECT subkey FROM system_settings WHERE key='TermData' ORDER BY subkey`
    );
    return rows.map(r => {
      const parts = (r.subkey || '').split('_');
      return parts.length === 2 ? { term: parts[0], year: parts[1] } : null;
    }).filter(Boolean);
  },

  // Config writes
  saveSystemConfig:                (args) => config.saveSystemConfig(args),
  saveCalendarEvent:               (args) => config.saveCalendarEvent(args),
  deleteCalendarEvent:             (args) => config.deleteCalendarEvent(args),
  importCalendarCSV:               (args) => config.importCalendarCSV(args),

  // Pages
  getPage:                         require('../functions/getPage'),

  // Dashboard bundles
  getTeacherDashboardBundle:       require('../functions/getTeacherDashboardBundle'),
  getAdminDashboardBundle:         require('../functions/getAdminDashboardBundle'),

  // Users — reads
  getAllUsers:                      (args, user) => require('../functions/getAllUsers')(args, user),
  getTeachersForTimetable:          require('../functions/getTeachersForTimetable'),
  getTeacherListForClubDropdown:    require('../functions/getTeachersForTimetable'),
  getStudentSummaryStats:          (args) => usersWrite.getStudentSummaryStats(args),

  // Users — writes
  addUser:                         (args) => usersWrite.addUser(args),
  editUser:                        (args) => usersWrite.editUser(args),
  deleteUser:                      (args) => usersWrite.deleteUser(args),
  importStudentCSV:                (args) => usersWrite.importStudentCSV(args),
  importTeacherCSV:                (args) => usersWrite.importTeacherCSV(args),

  // Students
  getStudentsByClass:              (args) => students.getStudentsByClass(args),
  getStudentsByClub:               (args) => students.getStudentsByClub(args),

  // Subjects / timetable
  getTeacherSubjects:              require('../functions/getTeacherSubjects'),

  // Timetable — reads
  getTeacherTimetableByDate:       (args) => require('../functions/timetable').getTeacherTimetableByDate(args),
  getTeacherTimetable:             (args) => require('../functions/timetable').getTeacherTimetable(args),
  getTeacherTimetableWithStatus:   (args) => require('../functions/timetable').getTeacherTimetableWithStatus(args),

  // Timetable — admin writes
  getFilteredTimetables:           (args) => timetableAdmin.getFilteredTimetables(args),
  updateTimetableRow:              (args) => timetableAdmin.updateTimetableRow(args),
  deleteTimetableRow:              (args) => timetableAdmin.deleteTimetableRow(args),
  importTimetableCSV:              (args) => timetableAdmin.importTimetableCSV(args),
  swapTimetableTeacher:            (args) => timetableAdmin.swapTimetableTeacher(args),
  teacherUpdateTimetableRow:       (args) => timetableAdmin.teacherUpdateTimetableRow(args),
  getHomeroomAssignments:          (args) => timetableAdmin.getHomeroomAssignments(args),
  setHomeroomTeacher:              (args) => timetableAdmin.setHomeroomTeacher(args),
  setAllHomeroomTeachers:          (args) => timetableAdmin.setAllHomeroomTeachers(args),

  // Attendance
  saveAttendanceBatch:             (args, user) => attendance.saveAttendanceBatch(args, user),
  saveLessonRecord:                (args, user) => attendance.saveLessonRecord(args, user),
  updateAttendanceStatus:          (args, user) => attendance.updateAttendanceStatus(args, user),
  updateAttendanceBatch:           (args, user) => attendance.updateAttendanceBatch(args, user),
  getTodayAttendanceHistory:       (args, user) => attendance.getTodayAttendanceHistory(args, user),
  getCourseSessionList:            (args, user) => attendance.getCourseSessionList(args, user),
  getMassiveAttendanceGrid:        (args, user) => attendance.getMassiveAttendanceGrid(args, user),
  saveMassiveAttendanceGrid:       (args, user) => attendance.saveMassiveAttendanceGrid(args, user),
  getSemesterReport:               async (args, user) => {
    const [subjectCode, className, term, year] = args;
    await verifyTeacherOwnsSubject(user, subjectCode, className, term, year);
    return attendance.getSemesterReport(args);
  },

  // Detailed lesson records
  getDetailedLessonRecords:        (args, user) => lessonRecords.getDetailedLessonRecords(args, user),
  saveDetailedLessonRecord:        (args, user) => lessonRecords.saveDetailedLessonRecord(args, user),
  deleteDetailedLessonRecord:      (args, user) => lessonRecords.deleteDetailedLessonRecord(args, user),
  updateDetailedLessonRecord:      (args, user) => lessonRecords.updateDetailedLessonRecord(args, user),

  // Scores (ปพ.5)
  getSubjectConfig:                (args) => scores.getSubjectConfig(args),
  saveSubjectConfig:               (args, user) => scores.saveSubjectConfig(args, user),
  getAllInOneScoreGridData:         (args, user) => scores.getAllInOneScoreGridData(args, user),
  saveAllInOneScores:              (args, user) => scores.saveAllInOneScores(args, user),
  saveAllInOneWithConfig:          (args, user) => scores.saveAllInOneWithConfig(args, user),

  // Academic reports
  getAllSubjectsReport:             require('../functions/getAllSubjectsReport'),

  // Calendar — filter personal events to owner only (admin sees all)
  getCalendarEvents: (args, user) => {
    return require('../functions/getCalendarEvents')(isAdmin(user) ? null : user?.id);
  },

  // Morning activity
  getMorningActivityData:          (args) => morning.getMorningActivityData(args),
  saveMorningActivityBatch:        (args) => morning.saveMorningActivityBatch(args),
  getTodayMorningSummary:          (args) => morning.getTodayMorningSummary(args),

  // Clubs — reads
  getClubList:                     require('../functions/getClubList'),
  // Clubs — writes
  createClub:                      (args) => clubsWrite.createClub(args),
  updateClub:                      (args) => clubsWrite.updateClub(args),
  registerClub:                    (args) => clubsWrite.registerClub(args),
  unregisterClub:                  (args) => clubsWrite.unregisterClub(args),

  // Leave & substitutes — reads
  getPendingLeaves:                (args) => leaveBundle.getPendingLeaves(args),
  getLeaveRequestBundle:           (args) => leaveBundle.getLeaveRequestBundle(args),
  getPendingSubstitutes:           (args) => leaveBundle.getPendingSubstitutes(args),
  // Leave — writes
  saveLeaveRequest:                (args, user) => leaveWrite.saveLeaveRequest(args, user),
  approveLeave:                    (args, user) => leaveWrite.approveLeave(args, user),
  rejectLeave:                     (args, user) => leaveWrite.rejectLeave(args, user),
  reviewLeave:                     (args, user) => leaveWrite.reviewLeave(args, user),
  updateLeave:                     (args) => leaveWrite.updateLeave(args),
  deleteLeave:                     (args) => leaveWrite.deleteLeave(args),
  assignSubstitute:                (args, user) => leaveWrite.assignSubstitute(args, user),
  unassignSubstitute:              (args) => leaveWrite.unassignSubstitute(args),
  manualCreateAffected:            (args) => leaveWrite.manualCreateAffected(args),
  saveSubstituteAssignment:        (args) => leaveWrite.saveSubstituteAssignment(args),
  confirmSubstitute:               (args) => leaveWrite.confirmSubstitute(args),

  // Sarabun
  getSarabunHistory:               require('../functions/getSarabunHistory'),
  saveSarabun:                     (args) => sarabun.saveSarabun(args),
  deleteSarabun:                   (args) => sarabun.deleteSarabun(args),
  requestSarabunNumber:            (args) => sarabun.requestSarabunNumber(args),

  // Budget
  getBudgets:                      (args) => budget.getBudgets(args),
  saveBudget:                      (args) => budget.saveBudget(args),

  // Missing functions (Phase 3 supplement)
  getTeacherRiskDashboard:         (args) => missing.getTeacherRiskDashboard(args),
  getTeacherAtRiskDashboard:       (args) => missing.getTeacherAtRiskDashboard(args),
  getStudentDashboardBundle:       (args) => missing.getStudentDashboardBundle(args),
  getExecutiveDashboardBundle:     (args) => missing.getExecutiveDashboardBundle(args),
  getClubMembers:                  (args) => missing.getClubMembers(args),
  getClubMembersForTeacher:        (args) => missing.getClubMembersForTeacher(args),
  getClubAttendanceSummary:        (args) => missing.getClubAttendanceSummary(args),
  deleteClub:                      (args) => missing.deleteClub(args),
  registerToClub:                  (args) => missing.registerToClub(args),
  unregisterFromClub:              (args) => missing.unregisterFromClub(args),
  getAllLeaves:                     (args) => missing.getAllLeaves(args),
  saveSchoolInfo:                  (args) => missing.saveSchoolInfo(args),
  savePrintConfigData:             (args) => missing.savePrintConfigData(args),
  getCurriculumData:               (args) => missing.getCurriculumData(args),
  importCurriculumCSV:             (args) => missing.importCurriculumCSV(args),
  addCurriculumItem:               (args) => missing.addCurriculumItem(args),
  updateCurriculumItem:            (args) => missing.updateCurriculumItem(args),
  deleteCurriculumItem:            (args) => missing.deleteCurriculumItem(args),
  setupCalendarDatabase:           () => missing.setupCalendarDatabase(),
  setupClubDatabase:               () => missing.setupClubDatabase(),
  setupCurriculumDatabase:         () => missing.setupCurriculumDatabase(),
  saveStudentRemarkDirectly:       (args) => missing.saveStudentRemarkDirectly(args),
  uploadSarabunFile:               (args) => missing.uploadSarabunFile(args),
  getTeacherListForDropdown:       () => missing.getTeacherListForDropdown(),
  getPrintConfigData:              (args) => missing.getPrintConfigData(args),
  generatePP5Template:             (args) => pp5.generatePP5Template(args),
  exportClubsForTerm:              (args) => missing.exportClubsForTerm(args),
  getMyClub:                       (args) => missing.getMyClub(args),
  getMyClubs:                      (args) => missing.getMyClubs(args),
  getCurriculumBySubject:          (args) => missing.getCurriculumBySubject(args),
  getAvailableSubstitutes:         (args) => missing.getAvailableSubstitutes(args),
  updateTaskStatus:                (args) => missing.updateTaskStatus(args),
  adminAddMember:                  (args) => missing.adminAddMember(args),
  adminRemoveMember:               (args) => missing.adminRemoveMember(args),
  promoteStudentsToNextYear:       () => missing.promoteStudentsToNextYear(),

  // Savings
  saveSavingsTransaction:          (args, user) => savings.saveSavingsTransaction(args, user),
  getSavingsBalance:               (args) => savings.getSavingsBalance(args),
  getSavingsSummary:               (args) => savings.getSavingsSummary(args),
  getSavingsHistory:               (args) => savings.getSavingsHistory(args),
  deleteSavingsTransaction:        (args) => savings.deleteSavingsTransaction(args),
  importSavingsCSV:                (args) => savings.importSavingsCSV(args),
  getClassListForSavings:          () => savings.getClassListForSavings(),

  // Todo (in-memory)
  getTodoList:                     require('../functions/getTodoList'),
  saveTodoList:                    async ([userId, json]) => { await require('../functions/getTodoList').save(userId, json); return { status: 'success', message: 'บันทึกสำเร็จ' }; },
};

router.post('/:fnName', async (req, res) => {
  const { fnName } = req.params;
  const { args = [] } = req.body;

  let user = null;
  if (!PUBLIC_FNS.has(fnName)) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.json({ __error: 'Unauthorized' });
    try {
      user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    } catch {
      return res.json({ __error: 'Token invalid or expired' });
    }
  }

  // Role-based authorization
  try {
    if (ADMIN_ONLY.has(fnName)) adminOnly(user);
    else if (TEACHER_OR_ADMIN.has(fnName)) teacherOrAdmin(user);
  } catch (e) {
    return res.json({ __error: e.message });
  }

  const handler = handlers[fnName];
  if (!handler) {
    console.warn(`[GAS] Unimplemented: ${fnName}`);
    return res.json({ __error: `'${fnName}' not implemented in web prototype yet` });
  }

  try {
    const result = await handler(args, user);

    // Invalidate related caches after successful writes
    if (TIMETABLE_WRITE_FNS.has(fnName)) {
      cache.delPrefix('tt_date_');
      cache.delPrefix('tt_own_');
      cache.delPrefix('tt_status_');
    }
    if (USER_WRITE_FNS.has(fnName)) {
      cache.delPrefix('students_');
      cache.del('all_users_admin');
      cache.del('all_users_redacted');
    }

    // Issue JWT on successful login
    let jwtToken = null;
    if (fnName === 'checkLogin' && result && result.status === 'success') {
      jwtToken = jwt.sign(
        { id: result.id, name: result.name, role: result.role, dept: result.dept },
        process.env.JWT_SECRET,
        { expiresIn: '90d' }
      );
    }

    res.json({ __result: result, ...(jwtToken ? { __jwt: jwtToken } : {}) });
  } catch (err) {
    console.error(`[GAS:${fnName}]`, err.message);
    res.json({ __error: err.message || String(err) });
  }
});

module.exports = router;
