const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const getCalendarEvents = require('./getCalendarEvents');

function section(fn) {
  return fn().then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message }));
}

async function adminStaffStats(config) {
  const today = new Date().toISOString().slice(0, 10);
  const [leaveRes, subRes, pendingListRes, staffCountRes, onLeaveRes] = await Promise.all([
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
    query(`SELECT COUNT(*) as cnt FROM users WHERE UPPER(role) != 'STUDENT'`),
    query(
      `SELECT COUNT(DISTINCT teacher_id) as cnt FROM leave_records
       WHERE status='อนุมัติ' AND start_date <= $1 AND end_date >= $1`,
      [today]
    ),
  ]);

  const totalStaff = parseInt(staffCountRes.rows[0]?.cnt || 0);
  const onLeave = parseInt(onLeaveRes.rows[0]?.cnt || 0);

  return {
    staffPresent: Math.max(0, totalStaff - onLeave),
    totalStaff,
    pendingLeaveCount: parseInt(leaveRes.rows[0]?.cnt || 0),
    pendingSubstitutes: parseInt(subRes.rows[0]?.cnt || 0),
    pendingLeaveList: pendingListRes.rows.map(r => ({
      name: r.staff_name, type: r.type, start: r.start, end: r.end,
    })),
  };
}

async function todayStudentsAttendance() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT class,
            COUNT(*) as total,
            COUNT(CASE WHEN flag_status IN ('มา','เข้าแถว','เข้า','ปกติ') THEN 1 END) as present
     FROM morning_activity WHERE date=$1
     GROUP BY class ORDER BY class`,
    [today]
  );
  const totalPresent = rows.reduce((s, r) => s + parseInt(r.present), 0);
  const totalStudents = rows.reduce((s, r) => s + parseInt(r.total), 0);
  return {
    present: totalPresent,
    total: totalStudents,
    byClass: rows.map(r => ({
      class: r.class,
      present: parseInt(r.present),
      total: parseInt(r.total),
    })),
    date: today,
  };
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

  const [staffStats, todayStudents, calendarEvents, availableTerms] = await Promise.all([
    section(() => adminStaffStats(config)),
    section(() => todayStudentsAttendance()),
    section(() => getCalendarEvents()),
    section(() => getAvailableTerms()),
  ]);

  return {
    ts: Date.now(), staffStats, todayStudents, calendarEvents, availableTerms,
    systemConfig: { ok: true, data: config },
  };
};
