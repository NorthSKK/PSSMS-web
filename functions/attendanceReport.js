const { query } = require('../lib/db');

const WEEKS_PER_TERM = 20;
const DEFAULT_PERIODS_PER_WEEK = 3;
const MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function normalize(s) {
  return String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');
}

function normID(id) {
  return String(id || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^0+/, '') || '0';
}

function tallyStatuses(records) {
  let present = 0, late = 0, leave = 0, absent = 0;
  for (const k in records) {
    const s = records[k];
    if (s === 'มา' || s === 'present') present++;
    else if (s === 'สาย' || s === 'late') late++;
    else if (s === 'ลา' || s === 'leave') leave++;
    else if (s === 'ขาด' || s === 'absent') absent++;
  }
  return { present, late, leave, absent };
}

async function loadTimetableMap(term, year) {
  const { rows } = await query(
    `SELECT subject_code, subject_name, level, room, teacher_id
     FROM timetable WHERE term=$1 AND year=$2`,
    [term, year]
  );
  return rows;
}

async function loadAttendance(term, year) {
  const { rows } = await query(
    `SELECT date, period, subject_code, class, student_id, student_name,
            status, session_id, teacher_id
     FROM attendance WHERE term=$1 AND year=$2`,
    [term, year]
  );
  return rows;
}

// Build teacherClasses map: { "${normSubj}_${normClass}": {rawCode, rawName, rawClassID, periodsPerWeek, sessions, students} }
function buildTeacherClasses(ttRows, attRows, teacherIdLower) {
  const teacherClasses = {};

  for (const r of ttRows) {
    const tTeacherID = String(r.teacher_id || '').trim().toLowerCase();
    if (teacherIdLower && tTeacherID !== teacherIdLower) continue;

    const tCode = normalize(r.subject_code);
    const rawClassID = `${String(r.level).trim()}/${String(r.room).trim()}`;
    const tClassID = normalize(rawClassID);
    const key = `${tCode}_${tClassID}`;

    if (!teacherClasses[key]) {
      teacherClasses[key] = {
        rawCode: r.subject_code,
        rawName: r.subject_name,
        rawClassID,
        periodsPerWeek: 0,
        sessions: new Set(),
        students: {},
      };
    }
    teacherClasses[key].periodsPerWeek++;
  }

  for (const r of attRows) {
    if (!r.date) continue;
    const key = `${normalize(r.subject_code)}_${normalize(r.class)}`;
    const cls = teacherClasses[key];
    if (!cls) continue;

    const stdID = String(r.student_id).trim();
    const stdKey = normID(stdID);
    const stdName = r.student_name;
    const sessionID = String(r.session_id || '').trim() || `${r.date}_${r.period}`;

    cls.sessions.add(sessionID);
    if (!cls.students[stdKey]) cls.students[stdKey] = { id: stdID, name: stdName, records: {} };
    cls.students[stdKey].records[sessionID] = r.status;
  }

  return teacherClasses;
}

// Frontend: .getSemesterReport(item[0], item[2], term, year) → (subjectCode, className, term, year)
async function getSemesterReport([subjectCode, className, term, year]) {
  const cleanSub = normalize(subjectCode);
  const cleanClass = normalize(className);

  const ttRows = await loadTimetableMap(term, year);
  let periodsPerWeek = 0;
  for (const r of ttRows) {
    if (normalize(r.subject_code) === cleanSub &&
        normalize(`${r.level}/${r.room}`) === cleanClass) periodsPerWeek++;
  }
  if (periodsPerWeek === 0) periodsPerWeek = DEFAULT_PERIODS_PER_WEEK;

  const totalCoursePeriods = periodsPerWeek * WEEKS_PER_TERM;
  const maxAbsenceQuota = Math.floor(totalCoursePeriods * 0.2);

  const attRows = await loadAttendance(term, year);
  const studentDataMap = {};
  const studentInfo = {};
  const sessionDetails = {};

  for (const r of attRows) {
    if (!r.date) continue;
    if (normalize(r.subject_code) !== cleanSub) continue;
    if (normalize(r.class) !== cleanClass) continue;

    const stdID = String(r.student_id).trim();
    const stdKey = normID(stdID);
    const sessionID = String(r.session_id || '').trim() || `${r.date}_${r.period}`;

    if (!sessionDetails[sessionID]) {
      const d = r.date instanceof Date ? r.date : new Date(r.date);
      if (!isNaN(d.getTime())) {
        sessionDetails[sessionID] = {
          id: sessionID, rawDate: d.getTime(),
          month: MONTHS[d.getMonth()], date: d.getDate(),
          period: String(r.period).trim(),
          displayDate: d.toISOString().split('T')[0],
        };
      } else {
        sessionDetails[sessionID] = { id: sessionID, rawDate: 0, month: '-', date: '-', period: String(r.period).trim(), displayDate: '' };
      }
    }
    if (!studentInfo[stdKey]) studentInfo[stdKey] = { id: stdID, name: r.student_name };
    if (!studentDataMap[stdKey]) studentDataMap[stdKey] = {};
    studentDataMap[stdKey][sessionID] = r.status;
  }

  const sessionsList = Object.values(sessionDetails).sort((a, b) => a.rawDate - b.rawDate);
  // Assign week numbers based on actual calendar week (Monday = start of week)
  // so sessions in the same calendar week share the same week number
  const mondayToWeek = new Map();
  let weekCounter = 0;
  for (const s of sessionsList) {
    const utcDay = new Date(s.rawDate).getUTCDay(); // 0=Sun, 1=Mon..6=Sat
    const mondayMs = s.rawDate - ((utcDay + 6) % 7) * 86400000;
    if (!mondayToWeek.has(mondayMs)) mondayToWeek.set(mondayMs, ++weekCounter);
    s.week = mondayToWeek.get(mondayMs);
  }
  const currentTotalTaught = sessionsList.length;

  const students = Object.keys(studentDataMap).map(stdKey => {
    const t = tallyStatuses(studentDataMap[stdKey]);
    const totalMissed = t.absent + t.leave;
    const percent = ((totalCoursePeriods - totalMissed) / totalCoursePeriods) * 100;
    return {
      id: studentInfo[stdKey].id, name: studentInfo[stdKey].name,
      present: t.present, late: t.late, leave: t.leave, absent: t.absent,
      percent: percent.toFixed(2),
      currentTotalTaught,
      records: studentDataMap[stdKey],
    };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    students,
    meta: { periodsPerWeek, weeksPerTerm: WEEKS_PER_TERM, totalCoursePeriods, maxAbsenceQuota, currentTotalTaught, sessionsList },
  };
}

// Frontend: .getAllSubjectsReport(user.id, term, year) → (teacherId, term, year)
async function getAllSubjectsReport([teacherId, term, year]) {
  const teacherIdLower = String(teacherId).trim().toLowerCase();
  const [ttRows, attRows] = await Promise.all([
    loadTimetableMap(term, year),
    loadAttendance(term, year),
  ]);

  const teacherClasses = buildTeacherClasses(ttRows, attRows, teacherIdLower);
  const out = [];

  for (const key in teacherClasses) {
    const cls = teacherClasses[key];
    const currentTotalTaught = cls.sessions.size;
    if (currentTotalTaught === 0) continue;

    const actualPeriodsPerWeek = cls.periodsPerWeek > 0 ? cls.periodsPerWeek : DEFAULT_PERIODS_PER_WEEK;
    const totalCoursePeriods = actualPeriodsPerWeek * WEEKS_PER_TERM;
    const maxAbsenceQuota = Math.floor(totalCoursePeriods * 0.2);

    for (const stdKey in cls.students) {
      const s = cls.students[stdKey];
      const t = tallyStatuses(s.records);
      const totalMissed = t.absent + t.leave;
      const percent = ((totalCoursePeriods - totalMissed) / totalCoursePeriods) * 100;
      const remainingQuota = maxAbsenceQuota - totalMissed;

      out.push({
        id: s.id, name: s.name,
        subjectCode: cls.rawCode, subjectName: cls.rawName, className: cls.rawClassID,
        present: t.present, late: t.late, leave: t.leave, absent: t.absent,
        percent: percent.toFixed(2),
        taught: currentTotalTaught, totalCoursePeriods, remainingQuota,
      });
    }
  }

  out.sort((a, b) => {
    if (a.subjectCode !== b.subjectCode) return String(a.subjectCode).localeCompare(String(b.subjectCode));
    if (a.className !== b.className) return String(a.className).localeCompare(String(b.className));
    return String(a.id).localeCompare(String(b.id));
  });
  return out;
}

// Frontend: .getTeacherAtRiskDashboard(teacherId, term, year)
// Returns {critical, ms, risk} bucketed by attendance percent
async function getTeacherAtRiskDashboard([teacherId, term, year]) {
  const teacherIdLower = String(teacherId).trim().toLowerCase();
  const [ttRows, attRows] = await Promise.all([
    loadTimetableMap(term, year),
    loadAttendance(term, year),
  ]);

  const teacherClasses = buildTeacherClasses(ttRows, attRows, teacherIdLower);
  const critical = [], ms = [], risk = [];

  for (const key in teacherClasses) {
    const cls = teacherClasses[key];
    const currentTotalTaught = cls.sessions.size;
    if (currentTotalTaught === 0) continue;

    const actualPeriodsPerWeek = cls.periodsPerWeek > 0 ? cls.periodsPerWeek : DEFAULT_PERIODS_PER_WEEK;
    const totalCoursePeriods = actualPeriodsPerWeek * WEEKS_PER_TERM;

    for (const stdKey in cls.students) {
      const s = cls.students[stdKey];
      const t = tallyStatuses(s.records);
      const totalMissed = t.absent + t.leave;
      const percent = ((totalCoursePeriods - totalMissed) / totalCoursePeriods) * 100;

      if (percent <= 85) {
        const item = {
          id: s.id, name: s.name,
          subjectCode: cls.rawCode, subjectName: cls.rawName, className: cls.rawClassID,
          present: t.present, late: t.late, leave: t.leave, absent: t.absent,
          percent: percent.toFixed(2), taught: currentTotalTaught,
        };
        if (percent < 60) critical.push(item);
        else if (percent < 80) ms.push(item);
        else risk.push(item);
      }
    }
  }

  const byPct = (a, b) => parseFloat(a.percent) - parseFloat(b.percent);
  critical.sort(byPct); ms.sort(byPct); risk.sort(byPct);
  return { critical, ms, risk };
}

module.exports = {
  getSemesterReport,
  getAllSubjectsReport,
  getTeacherAtRiskDashboard,
};
