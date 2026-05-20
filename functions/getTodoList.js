const { query } = require('../lib/db');

module.exports = async function getTodoList([userId]) {
  if (!userId) return '[]';
  const { rows } = await query(
    `SELECT value1 FROM system_settings WHERE key='todo' AND subkey=$1`,
    [String(userId)]
  );
  return rows[0]?.value1 || '[]';
};

module.exports.save = async function(userId, json) {
  if (!userId || !json) return true;
  await query(
    `INSERT INTO system_settings(key, subkey, value1)
     VALUES('todo', $1, $2)
     ON CONFLICT(key, subkey) DO UPDATE SET value1=$2`,
    [String(userId), String(json)]
  );
  return true;
};
