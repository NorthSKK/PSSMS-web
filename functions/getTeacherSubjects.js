const { query } = require('../lib/db');

module.exports = async function getTeacherSubjects([userId, userRole, targetTerm, targetYear]) {
  const isAdmin = String(userRole || '').toUpperCase() === 'ADMIN';
  const params = [targetTerm, targetYear];
  let sql = `SELECT DISTINCT subject_code, subject_name,
                    level || '/' || room as class_id, location
             FROM timetable WHERE term=$1 AND year=$2
               AND subject_name NOT LIKE '%ชุมนุม%'`;
  if (!isAdmin) { params.push(userId); sql += ` AND teacher_id=$${params.length}`; }
  sql += ' ORDER BY subject_code, class_id';

  const { rows } = await query(sql, params);
  const subjects = rows.map(r => [
    r.subject_code,
    r.subject_name,
    r.class_id,
    `${r.class_id} (${r.location || ''})`,
  ]);

  if (!isAdmin) {
    const clubRes = await query(
      `SELECT ca.club_id, c.club_name FROM club_advisors ca
       JOIN clubs c USING (club_id)
       WHERE ca.teacher_id=$1 AND ca.term=$2 AND ca.year=$3
       ORDER BY c.club_name`,
      [userId, targetTerm, targetYear]
    );
    for (const r of clubRes.rows) {
      subjects.push([r.club_id, r.club_name, 'ชุมนุม', `ชุมนุม - ${r.club_name}`]);
    }
  }

  return subjects;
};
