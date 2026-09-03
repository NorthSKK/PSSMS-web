const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');
const { assertRows, prepareRows, assertNoErrors } = require('../lib/importSpec');

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

// แถวซ้ำ = สอนวิชาเดียวกัน ห้องเดียวกัน ครูคนเดียวกัน วัน+คาบเดียวกัน ในเทอม/ปีเดียวกัน
// (import CSV ซ้ำรอบสองทำให้เกิด แล้วรายงานคาบสอนจะนับซ้ำตาม)
const _dupKey = (r) => [r.subject_code, r.level, r.room, r.teacher_id, r.day, r.period]
  .map(v => String(v == null ? '' : v).trim()).join('|');

// เก็บแถวแรก (id น้อยสุด) ทิ้งที่เหลือ — find กับ remove ต้องเรียงเหมือนกัน
// ไม่งั้นหน้าจอบอกว่าจะลบแถวหนึ่ง แต่ระบบไปลบอีกแถว
async function _dupGroups(term, year) {
  const { rows } = await query(
    `SELECT * FROM timetable WHERE term=$1 AND year=$2 ORDER BY id`,
    [String(term), String(year)]
  );
  const byKey = new Map();
  for (const r of rows) {
    const k = _dupKey(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  return [...byKey.values()].filter(g => g.length > 1);
}

async function findDuplicateTimetableRows([term, year]) {
  const groups = await _dupGroups(term, year);
  // frontend อ่าน row.rowIdx (ไม่ใช่ rowIndex เหมือน getFilteredTimetables)
  return groups.map(g => g.map(r => ({ rowIdx: r.id, data: rowToArray(r) })));
}

async function removeDuplicateTimetableRows([term, year]) {
  const groups = await _dupGroups(term, year);
  const ids = groups.flatMap(g => g.slice(1).map(r => r.id));
  if (!ids.length) return { status: 'success', message: 'ไม่พบแถวซ้ำ', removed: 0 };
  await query(`DELETE FROM timetable WHERE id = ANY($1::int[])`, [ids]);
  return { status: 'success', message: `ลบแถวซ้ำ ${ids.length} แถว (เก็บไว้ ${groups.length} แถว)`, removed: ids.length };
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

/**
 * นำเข้าตารางสอน — **ล้างตารางสอนของเทอม/ปีที่ active ทั้งหมดแล้วใส่ใหม่**
 * เหตุผลที่ไม่ใช่ upsert อยู่ใน `docs/adr/0003-import-people-upsert-timetable-replace.md`
 *
 * เทอม/ปีมาจากค่า active ในระบบเท่านั้น ไม่ใช่คอลัมน์ในไฟล์ — ขอบเขต DELETE
 * ห้ามมาจากช่องใน Excel พิมพ์ปีผิดตัวเดียวคือลบตารางสอนของปีที่ใช้งานอยู่ทิ้ง
 */
async function importTimetableCSV([rows]) {
  assertRows(rows);
  const prepared = prepareRows('timetable', rows);
  const errors = prepared.errors;

  const { term, year } = await require('./getSystemConfig')();

  // ครูต้องมีตัวตนก่อน — ของเดิม `continue` ทิ้งแถวเงียบ ๆ ครูทั้งคนหายจากตารางสอน
  // โดยที่ยอด "นำเข้า N รายการ" ยังขึ้นเป็นสีเขียว
  const teacherIds = [...new Set(prepared.rows.map((r) => r.teacherId).filter(Boolean))];
  const known = new Set();
  if (teacherIds.length) {
    const { rows: found } = await query(
      `SELECT username FROM users WHERE username = ANY($1)`, [teacherIds]
    );
    for (const u of found) known.add(u.username);
  }
  prepared.rows.forEach((r, i) => {
    if (r.teacherId && !known.has(r.teacherId)) {
      errors.push({ row: i + 2, message: `ไม่พบครูชื่อผู้ใช้ "${r.teacherId}" ในระบบ — นำเข้าครูก่อน` });
    }
  });

  assertNoErrors(errors);

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let removed = 0;
  try {
    await client.query('BEGIN');
    const del = await client.query(
      `DELETE FROM timetable WHERE term=$1 AND year=$2`, [String(term), String(year)]
    );
    removed = del.rowCount;
    for (const r of prepared.rows) {
      await client.query(
        `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.subjectCode, r.subjectName, r.level, r.room, r.location,
         r.teacherId, r.day, r.period, String(term), String(year)]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return {
    status: 'success',
    imported: prepared.rows.length,
    removed,
    message: `นำเข้าตารางสอนเทอม ${term}/${year} สำเร็จ — ลบของเดิม ${removed} แถว ใส่ใหม่ ${prepared.rows.length} แถว`,
  };
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

async function teacherUpdateTimetableRow([teacherId, rowIndex, newData], user) {
  const { rows } = await query(
    `SELECT teacher_id FROM timetable WHERE id=$1`, [rowIndex]
  );
  if (!rows.length) throw new Error('ไม่พบรายการ');
  // Compare against the JWT identity, not the payload — a payload-vs-payload check
  // lets any teacher edit any row by sending that row's owner id.
  if (!isAdmin(user) && String(rows[0].teacher_id).trim().toLowerCase() !== String(user?.id || '').trim().toLowerCase())
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
  findDuplicateTimetableRows,
  removeDuplicateTimetableRows,
  updateTimetableRow,
  deleteTimetableRow,
  importTimetableCSV,
  swapTimetableTeacher,
  teacherUpdateTimetableRow,
  getHomeroomAssignments,
  setHomeroomTeacher,
  setAllHomeroomTeachers,
};
