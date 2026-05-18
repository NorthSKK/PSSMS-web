const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const cache = require('../lib/cache');

module.exports = async function getAllUsers() {
  const cached = cache.get('all_users');
  if (cached) return cached;

  const config = await getSystemConfig();
  const { rows } = await query(
    `SELECT username, password, full_name, role, department, email, year, status
     FROM users WHERE UPPER(role) != 'STUDENT' OR year=$1
     ORDER BY username`,
    [config.year]
  );

  // Return array-of-arrays matching Sheets row format:
  // [0]username [1]password [2]full_name [3]role [4]department [5]email [6]year [7]status
  const result = rows.map(r => [
    r.username, r.password, r.full_name, r.role,
    r.department || '', r.email || '', r.year || '', r.status || 'ปกติ',
  ]);
  cache.set('all_users', result, 300);
  return result;
};
