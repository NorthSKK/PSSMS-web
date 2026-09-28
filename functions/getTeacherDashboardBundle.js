const getSystemConfig = require('./getSystemConfig');
const getCalendarEvents = require('./getCalendarEvents');
const { getTeacherTimetableWithStatus, getMySubstituteSlots } = require('./timetable');
const { getTeacherRiskDashboard } = require('./missing');
const { getTeacherRiskWatch } = require('./riskWatch');
const { isManagement } = require('../lib/permissions');

function section(fn) {
  return fn().then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message }));
}

module.exports = async function getTeacherDashboardBundle([teacherId, term, year], user) {
  const config = await getSystemConfig();
  const t = term || config.term;
  const y = year || config.year;
  // riskWatch exposes per-student scores — the id comes from the JWT, never the
  // payload (Admin/Executive may still look at another teacher's board).
  const watchId = user && !isManagement(user) ? user.id : teacherId;

  const [timetable, calendarEvents, riskDashboard, riskWatch, substitutes] = await Promise.all([
    section(() => getTeacherTimetableWithStatus([teacherId])),
    section(() => getCalendarEvents(teacherId)),
    section(() => getTeacherRiskDashboard([teacherId, t, y])),
    section(() => getTeacherRiskWatch([watchId, t, y])),
    section(() => getMySubstituteSlots([teacherId, 7])),
  ]);

  return { ts: Date.now(), timetable, calendarEvents, riskDashboard, riskWatch, substitutes };
};
