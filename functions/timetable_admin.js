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
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function deleteTimetableRow([rowIndex]) {
  await query(`DELETE FROM timetable WHERE id=$1`, [rowIndex]);
  return { status: 'success', message: 'ลบสำเร็จ' };
}

async function importTimetableCSV([rows]) {
  if (!Array.isArray(rows) || rows.length === 0) return { status: 'success', message: 'ไม่มีข้อมูล', imported: 0 };
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
  return { status: 'success', message: `นำเข้า ${count} รายการ`, imported: count };
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
  return { status: 'success', message: 'แลกตารางสอนสำเร็จ' };
}

async function teacherUpdateTimetableRow([teacherId, rowIndex, newData]) {
  const { rows } = await query(
    `SELECT teacher_id FROM timetable WHERE id=$1`, [rowIndex]
  );
  if (!rows.length) throw new Error('ไม่พบรายการ');
  if (String(rows[0].teacher_id).trim() !== String(teacherId).trim())
    throw new Error('ไม่มีสิทธิ์แก้ไขรายการนี้');
  // Only allow editing display fields — subject_code/teacher_id/term/year are locked in DB
  await query(
    `UPDATE timetable SET subject_name=$1, level=$2, room=$3, location=$4, day=$5, period=$6 WHERE id=$7`,
    [newData[1], newData[2], newData[3], newData[4] || '', newData[6], newData[7], rowIndex]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function getHomeroomAssignments([term, year]) {
  const { rows } = await query(
    `SELECT level, room, teacher_id, subject_code, subject_name, location
     FROM timetable
     WHERE (UPPER(subject_code)='HR' OR subject_name ILIKE '%โฮมรูม%'
            OR subject_name ILIKE '%แนะแนว%' OR subject_name ILIKE '%วิถีพุทธ%')
       AND term=$1 AND year=$2
     ORDER BY level, room, id`,
    [term, year]
  );
  const map = {};
  for (const r of rows) {
    const key = `${r.level}/${r.room}`;
    if (!map[key]) map[key] = { level: r.level, room: r.room, teacherIds: [], advisoryLoc: '', buddhistLoc: '' };
    const code = String(r.subject_code || '').toUpperCase();
    const name = String(r.subject_name || '');
    if (code === 'HR' || name.includes('โฮมรูม')) {
      if (r.teacher_id && !map[key].teacherIds.includes(r.teacher_id)) map[key].teacherIds.push(r.teacher_id);
    } else if (name.includes('แนะแนว')) {
      map[key].advisoryLoc = r.location || '';
    } else if (name.includes('วิถีพุทธ')) {
      map[key].buddhistLoc = r.location || '';
    }
  }
  return Object.values(map).sort((a, b) =>
    `${a.level}/${a.room}`.localeCompare(`${b.level}/${b.room}`, 'th', { numeric: true })
  );
}

const WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];

async function setHomeroomTeacher([teacherId, className, term, year]) {
  const parts = String(className).split('/');
  const level = parts[0] || '';
  const room = parts[1] || '';

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM timetable
       WHERE (UPPER(subject_code)='HR' OR subject_name ILIKE '%โฮมรูม%')
         AND level=$1 AND room=$2 AND term=$3 AND year=$4`,
      [level, room, term, year]
    );
    for (const day of WEEKDAYS) {
      await client.query(
        `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
         VALUES('HR','กิจกรรมโฮมรูมหน้าเสาธง',$1,$2,$3,$4,'0',$5,$6)`,
        [level, room, teacherId, day, term, year]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { status: 'success', message: 'บันทึกครูที่ปรึกษาสำเร็จ' };
}

async function setAllHomeroomTeachers([assignments, term, year]) {
  if (!Array.isArray(assignments) || assignments.length === 0)
    return { status: 'success', message: 'ไม่มีข้อมูลที่จะบันทึก' };
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of assignments) {
      const { level, room, teacherIds = [], opts = {} } = a;
      if (!level || !room) continue;
      await client.query(
        `DELETE FROM timetable
         WHERE (UPPER(subject_code)='HR' OR subject_name ILIKE '%โฮมรูม%'
                OR subject_name ILIKE '%แนะแนว%' OR subject_name ILIKE '%วิถีพุทธ%')
           AND level=$1 AND room=$2 AND term=$3 AND year=$4`,
        [level, room, term, year]
      );
      for (const tid of teacherIds) {
        if (!tid) continue;
        for (const day of WEEKDAYS) {
          await client.query(
            `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year,location)
             VALUES('HR','กิจกรรมโฮมรูมหน้าเสาธง',$1,$2,$3,$4,'0',$5,$6,'ลานหน้าเสาธง')`,
            [level, room, tid, day, term, year]
          );
        }
      }
      const t1 = teacherIds[0];
      if (t1) {
        await client.query(
          `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year,location)
           VALUES('-','แนะแนว',$1,$2,$3,'จันทร์','7',$4,$5,$6)`,
          [level, room, t1, term, year, opts.advisoryLoc || '']
        );
        await client.query(
          `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year,location)
           VALUES('-','วิถีพุทธ',$1,$2,$3,'ศุกร์','7',$4,$5,$6)`,
          [level, room, t1, term, year, opts.buddhistLoc || '']
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { status: 'success', message: `บันทึกครูที่ปรึกษา ${assignments.length} ห้องเรียนสำเร็จ` };
}

module.exports = {
  getFilteredTimetables,
  updateTimetableRow,
  deleteTimetableRow,
  importTimetableCSV,
  swapTimetableTeacher,
  teacherUpdateTimetableRow,
  getHomeroomAssignments,
  setHomeroomTeacher,
  setAllHomeroomTeachers,
};
