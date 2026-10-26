const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const cache = require('../lib/cache');
const { isManagement } = require('../lib/permissions');
const { assignStudentNumbers } = require('../lib/studentRoster');

module.exports = async function getAllUsers(args, user) {
  // getAllUsers is gated management-only in routes/gas.js.
  const managementCaller = isManagement(user);
  const cacheKey = managementCaller ? 'all_users_management' : 'all_users_redacted';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const config = await getSystemConfig();
  const { rows } = await query(
    `SELECT username, password, full_name, role, department, email, year, status, student_no
     FROM users WHERE UPPER(role) != 'STUDENT' OR year=$1
     ORDER BY username`,
    [config.year]
  );

  assignStudentNumbers(rows.filter(r => String(r.role).toUpperCase() === 'STUDENT'));
  // [0..7] legacy fields, [8] เลขที่ที่กำหนดหรือค่าเริ่มต้นตามลำดับรหัสเดิม
  const result = rows.map(r => [
    r.username, managementCaller ? r.password : '', r.full_name, r.role,
    r.department || '', r.email || '', r.year || '', r.status || 'ปกติ', r.student_no ?? null,
  ]);
  cache.set(cacheKey, result, 60);
  return result;
};
