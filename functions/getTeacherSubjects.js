const { query } = require('../lib/db');

module.exports = async function getTeacherSubjects([userId, userRole, targetTerm, targetYear]) {
  const isAdmin = String(userRole || '').toUpperCase() === 'ADMIN';
  const params = [targetTerm, targetYear];
  let sql = `SELECT DISTINCT subject_code, subject_name,
                    level || '/' || room as class_id, location
             FROM timetable WHERE term=$1 AND year=$2`;
  if (!isAdmin) { params.push(userId); sql += ` AND teacher_id=$${params.length}`; }
  sql += ' ORDER BY subject_code, class_id';

  const { rows } = await query(sql, params);
  return rows.map(r => [
    r.subject_code,
    r.subject_name,
    r.class_id,
    `${r.class_id} (${r.location || ''})`,
  ]);
};
