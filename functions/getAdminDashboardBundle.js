const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const getCalendarEvents = require('./getCalendarEvents');

function section(fn) {
  return fn().then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message }));
}

async function adminStaffStats(config) {
  const [usersRes, leaveRes, subRes, pendingListRes] = await Promise.all([
    query(
      `SELECT UPPER(role) as role, COUNT(*) as cnt FROM users
       WHERE UPPER(role) != 'STUDENT' OR year=$1 GROUP BY UPPER(role)`,
      [config.year]
    ),
    query(
      `SELECT COUNT(*) as cnt FROM leave_records WHERE status='รอพิจารณา' AND year=$1`,
      [config.year]
    ),
    query(`SELECT COUNT(*) as cnt FROM substitute_assignments WHERE status='รอจัด'`),
    query(
      `SELECT staff_name, type,
              to_char(start_date,'YYYY-MM-DD') as start,
              to_char(end_date,'YYYY-MM-DD') as end
       FROM leave_records WHERE status='รอพิจารณา' AND year=$1 ORDER BY request_date DESC LIMIT 5`,
      [config.year]
    ),
  ]);

  let studentCount = 0, teacherCount = 0;
  for (const r of usersRes.rows) {
    if (r.role === 'STUDENT') studentCount += parseInt(r.cnt);
    else teacherCount += parseInt(r.cnt);
  }

  return {
    studentCount, teacherCount,
    pendingLeaveCount: parseInt(leaveRes.rows[0]?.cnt || 0),
    pendingSubstitutes: parseInt(subRes.rows[0]?.cnt || 0),
    pendingLeaveList: pendingListRes.rows.map(r => ({
      name: r.staff_name, type: r.type, start: r.start, end: r.end,
    })),
  };
}

async function studentSummaryStats(config) {
  const { rows } = await query(
    `SELECT year, COUNT(*) as cnt FROM users WHERE UPPER(role)='STUDENT' AND year=$1 GROUP BY year`,
    [config.year]
  );
  const total = rows.reduce((s, r) => s + parseInt(r.cnt), 0);
  return { total, byYear: Object.fromEntries(rows.map(r => [r.year, parseInt(r.cnt)])) };
}

async function getAvailableTerms() {
  const { rows } = await query(
    `SELECT subkey, value1, value2 FROM system_settings WHERE key='TermData' ORDER BY subkey`
  );
  return rows.map(r => {
    const parts = (r.subkey || '').split('_');
    return parts.length === 2 ? { term: parts[0], year: parts[1], start: r.value1 || '', end: r.value2 || '' } : null;
  }).filter(Boolean);
}

module.exports = async function getAdminDashboardBundle() {
  const config = await getSystemConfig();

  const [staffStats, studentSummary, calendarEvents, availableTerms] = await Promise.all([
    section(() => adminStaffStats(config)),
    section(() => studentSummaryStats(config)),
    section(() => getCalendarEvents()),
    section(() => getAvailableTerms()),
  ]);

  return {
    ts: Date.now(), staffStats, studentSummary, calendarEvents, availableTerms,
    systemConfig: { ok: true, data: config },
  };
};
