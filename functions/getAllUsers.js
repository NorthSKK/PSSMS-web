const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const cache = require('../lib/cache');
const { isAdmin } = require('../lib/permissions');

module.exports = async function getAllUsers(args, user) {
  // getAllUsers is gated admin-only in routes/gas.js ADMIN_ONLY set.
  // Non-admins are rejected before reaching here; isAdmin check is a safety net.
  const adminCaller = isAdmin(user);
  const cacheKey = adminCaller ? 'all_users_admin' : 'all_users_redacted';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const config = await getSystemConfig();
  const { rows } = await query(
    `SELECT username, password, full_name, role, department, email, year, status
     FROM users WHERE UPPER(role) != 'STUDENT' OR year=$1
     ORDER BY username`,
    [config.year]
  );

  // [0]username [1]password [2]full_name [3]role [4]department [5]email [6]year [7]status
  const result = rows.map(r => [
    r.username, adminCaller ? r.password : '', r.full_name, r.role,
    r.department || '', r.email || '', r.year || '', r.status || 'ปกติ',
  ]);
  cache.set(cacheKey, result, 60);
  return result;
};
