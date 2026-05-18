const { query } = require('../lib/db');

// Data array format: [subject_code, subject_name, level, room, location, teacher_id, day, period, term, year]
function rowToArray(r) {
  return [
    r.subject_code, r.subject_name, r.level, r.room,
    r.location || '', r.teacher_id, r.day, r.period, r.term, r.year,
  ];
}

async function getFilteredTimetables([teacherId, term, year]) {
  const params = [term, year];
  let sql = `SELECT * FROM timetable WHERE term=$1 AND year=$2`;
  if (teacherId) { params.push(teacherId); sql += ` AND teacher_id=$${params.length}`; }
  sql += ' ORDER BY day, period';
  const { rows } = await query(sql, params);
  return rows.map(r => ({ rowIndex: r.id, data: rowToArray(r) }));
}

async function updateTimetableRow([rowIndex, data]) {
  // data = [subject_code, subject_name, level, room, location, teacher_id, day, period, term, year]
  await query(
    `UPDATE timetable SET subject_code=$1,subject_name=$2,level=$3,room=$4,
     location=$5,teacher_id=$6,day=$7,period=$8,term=$9,year=$10 WHERE id=$11`,
    [...data, rowIndex]
  );
  return { success: true };
}

async function deleteTimetableRow([rowIndex]) {
  await query(`DELETE FROM timetable WHERE id=$1`, [rowIndex]);
  return { success: true };
}

async function importTimetableCSV([rows]) {
  if (!Array.isArray(rows) || rows.length === 0) return { success: true, imported: 0 };
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      if (!r.teacher_id && !r.teacherId) continue;
      const teacherId = String(r.teacherId || r.teacher_id).trim();
      const check = await client.query(
        `SELECT 1 FROM users WHERE username=$1`, [teacherId]
      );
      if (check.rowCount === 0) continue;
      await client.query(
        `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          String(r.subjectCode || r.subject_code || '').trim(),
          String(r.subjectName || r.subject_name || '').trim(),
          String(r.level || '').trim(),
          String(r.room || '').trim(),
          String(r.location || '').trim(),
          teacherId,
          String(r.day || '').trim(),
          String(r.period || '').trim(),
          String(r.term || '').trim(),
          String(r.year || '').trim(),
        ]
      );
      count++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { success: true, imported: count };
}

async function swapTimetableTeacher([rowId1, rowId2]) {
  const { rows } = await query(
    `SELECT id, teacher_id FROM timetable WHERE id=ANY($1)`,
    [[rowId1, rowId2]]
  );
  if (rows.length < 2) throw new Error('ไม่พบแถวที่ระบุ');
  const [a, b] = rows;
  await query(`UPDATE timetable SET teacher_id=$1 WHERE id=$2`, [b.teacher_id, a.id]);
  await query(`UPDATE timetable SET teacher_id=$1 WHERE id=$2`, [a.teacher_id, b.id]);
  return { success: true };
}

async function getHomeroomAssignments([term, year]) {
  const { rows } = await query(
    `SELECT id, level, room, teacher_id,
            (SELECT full_name FROM users WHERE username=timetable.teacher_id) as teacher_name
     FROM timetable
     WHERE (UPPER(subject_code)='HR' OR subject_name ILIKE '%โฮมรูม%')
       AND term=$1 AND year=$2
     ORDER BY level, room`,
    [term, year]
  );
  return rows.map(r => ({
    rowIndex: r.id,
    className: `${r.level}/${r.room}`,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name || '',
  }));
}

async function setHomeroomTeacher([teacherId, className, term, year]) {
  const parts = String(className).split('/');
  const level = parts[0] || '';
  const room = parts[1] || '';

  const existing = await query(
    `SELECT id FROM timetable
     WHERE (UPPER(subject_code)='HR' OR subject_name ILIKE '%โฮมรูม%')
       AND level=$1 AND room=$2 AND term=$3 AND year=$4`,
    [level, room, term, year]
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE timetable SET teacher_id=$1
       WHERE (UPPER(subject_code)='HR' OR subject_name ILIKE '%โฮมรูม%')
         AND level=$2 AND room=$3 AND term=$4 AND year=$5`,
      [teacherId, level, room, term, year]
    );
  } else {
    await query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
       VALUES('HR','โฮมรูม',$1,$2,$3,'จันทร์','0',$4,$5)`,
      [level, room, teacherId, term, year]
    );
  }
  return { success: true };
}

async function setAllHomeroomTeachers([assignments, term, year]) {
  if (!Array.isArray(assignments)) return { success: true };
  const results = await Promise.all(
    assignments.map(a => setHomeroomTeacher([a.teacherId, a.className, term, year]))
  );
  return { success: true, updated: results.length };
}

module.exports = {
  getFilteredTimetables,
  updateTimetableRow,
  deleteTimetableRow,
  importTimetableCSV,
  swapTimetableTeacher,
  getHomeroomAssignments,
  setHomeroomTeacher,
  setAllHomeroomTeachers,
};
