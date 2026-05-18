const { query } = require('../lib/db');

module.exports = async function getTeachersForTimetable() {
  const { rows } = await query(
    `SELECT username, full_name, role FROM users
     WHERE UPPER(role) IN ('TEACHER','ADMIN','EXECUTIVE')
     ORDER BY username`
  );
  return rows.map(r => ({ id: r.username, name: r.full_name, role: r.role.toUpperCase() }));
};
