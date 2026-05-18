const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');

module.exports = async function checkLogin([username, password]) {
  const [result, config] = await Promise.all([
    query(
      `SELECT username, full_name, role, department FROM users WHERE username=$1 AND password=$2`,
      [String(username || '').trim(), String(password || '').trim()]
    ),
    getSystemConfig(),
  ]);

  const user = result.rows[0];
  if (!user) return { status: 'fail', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

  return {
    status: 'success',
    id: user.username,
    name: user.full_name,
    role: user.role,
    dept: user.department || '',
    currentTerm: config.term,
    currentYear: config.year,
  };
};
