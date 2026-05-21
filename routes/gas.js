const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Functions callable without a valid session token
const PUBLIC_FNS = new Set(['checkLogin', 'getSystemConfig']);

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
  getAllUsers:                      require('../functions/getAllUsers'),
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
  saveAttendanceBatch:             (args) => attendance.saveAttendanceBatch(args),
  saveLessonRecord:                (args) => attendance.saveLessonRecord(args),
  updateAttendanceStatus:          (args) => attendance.updateAttendanceStatus(args),
  updateAttendanceBatch:           (args) => attendance.updateAttendanceBatch(args),
  getTodayAttendanceHistory:       (args) => attendance.getTodayAttendanceHistory(args),
  getCourseSessionList:            (args) => attendance.getCourseSessionList(args),
  getMassiveAttendanceGrid:        (args) => attendance.getMassiveAttendanceGrid(args),
  saveMassiveAttendanceGrid:       (args) => attendance.saveMassiveAttendanceGrid(args),
  getSemesterReport:               (args) => attendance.getSemesterReport(args),

  // Detailed lesson records
  getDetailedLessonRecords:        (args) => lessonRecords.getDetailedLessonRecords(args),
  saveDetailedLessonRecord:        (args) => lessonRecords.saveDetailedLessonRecord(args),
  deleteDetailedLessonRecord:      (args) => lessonRecords.deleteDetailedLessonRecord(args),
  updateDetailedLessonRecord:      (args) => lessonRecords.updateDetailedLessonRecord(args),

  // Scores (ปพ.5)
  getSubjectConfig:                (args) => scores.getSubjectConfig(args),
  saveSubjectConfig:               (args) => scores.saveSubjectConfig(args),
  getAllInOneScoreGridData:         (args) => scores.getAllInOneScoreGridData(args),
  saveAllInOneScores:              (args) => scores.saveAllInOneScores(args),
  saveAllInOneWithConfig:          (args) => scores.saveAllInOneWithConfig(args),

  // Academic reports
  getAllSubjectsReport:             require('../functions/getAllSubjectsReport'),

  // Calendar — filter personal events to owner only (admin sees all)
  getCalendarEvents: (args, user) => {
    const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN';
    return require('../functions/getCalendarEvents')(isAdmin ? null : user?.id);
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
  saveLeaveRequest:                (args) => leaveWrite.saveLeaveRequest(args),
  approveLeave:                    (args) => leaveWrite.approveLeave(args),
  rejectLeave:                     (args) => leaveWrite.rejectLeave(args),
  reviewLeave:                     (args) => leaveWrite.reviewLeave(args),
  updateLeave:                     (args) => leaveWrite.updateLeave(args),
  deleteLeave:                     (args) => leaveWrite.deleteLeave(args),
  assignSubstitute:                (args) => leaveWrite.assignSubstitute(args),
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

  // Todo (in-memory)
  getTodoList:                     require('../functions/getTodoList'),
  saveTodoList:                    async ([userId, json]) => { require('../functions/getTodoList').save(userId, json); return true; },
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

  const handler = handlers[fnName];
  if (!handler) {
    console.warn(`[GAS] Unimplemented: ${fnName}`);
    return res.json({ __error: `'${fnName}' not implemented in web prototype yet` });
  }

  try {
    const result = await handler(args, user);

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
