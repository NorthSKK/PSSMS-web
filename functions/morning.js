const { query } = require('../lib/db');
const { resolveTeacherId } = require('../lib/permissions');

async function getMorningActivityData([date, className]) {
  const { rows } = await query(
    `SELECT id, student_id, student_name, area_status, duty_status, flag_status, session_id
     FROM morning_activity WHERE date=$1 AND class=$2 ORDER BY student_id`,
    [date, className]
  );
  const normArea = v => ['ปกติ','มา','เข้าแถว'].includes(v) ? 'ปกติ' : (v === 'ไม่ปกติ' ? 'ไม่ปกติ' : 'ปกติ');
  const normDuty = v => ['ทำหน้าที่','มา','ทำ','ปกติ'].includes(v) ? 'ทำหน้าที่' : (v === 'ไม่ทำหน้าที่' ? 'ไม่ทำหน้าที่' : 'ทำหน้าที่');
  const normFlag = v => ['เข้าแถว','มา','ปกติ','เข้า'].includes(v) ? 'เข้าแถว' : (v === 'ไม่เข้าแถว' ? 'ไม่เข้าแถว' : 'เข้าแถว');

  const result = {};
  for (const r of rows) {
    result[String(r.student_id).trim()] = {
      area: normArea(r.area_status),
      duty: normDuty(r.duty_status),
      flag: normFlag(r.flag_status),
    };
  }
  return result;
}

async function saveMorningActivityBatch([payload], user) {
  // payload can be { date, term, year, className, teacherId, records: [...] } or a raw array
  let list;
  if (Array.isArray(payload)) {
    list = payload;
  } else if (payload && Array.isArray(payload.records)) {
    list = payload.records.map(r => ({
      date: payload.date, term: payload.term, year: payload.year,
      className: payload.className, teacherId: payload.teacherId,
      studentId: r.studentId, studentName: r.studentName,
      areaStatus: r.area || r.areaStatus || '',
      dutyStatus: r.duty || r.dutyStatus || '',
      flagStatus: r.flag || r.flagStatus || '',
    }));
  } else {
    list = [];
  }
  if (list.length === 0) return { status: 'success', message: 'ไม่มีรายการ', saved: 0 };
  const first = list[0];
  const sessionId = `${first.date}|morning|${first.className}`;
  // Identity comes from the JWT, never the payload — otherwise a teacher could write
  // rows attributed to a colleague. Admin may still act on a specific teacher's behalf.
  const effectiveTeacherId = resolveTeacherId(user, first.teacherId);
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Scoped to the acting teacher: re-saving replaces only their own rows for this
    // session, so a batch can't wipe another teacher's homeroom record for the same class.
    await client.query(
      `DELETE FROM morning_activity WHERE session_id=$1 AND LOWER(teacher_id)=LOWER($2)`,
      [sessionId, effectiveTeacherId]
    );
    for (const item of list) {
      await client.query(
        `INSERT INTO morning_activity(date,term,year,class,student_id,student_name,area_status,duty_status,flag_status,teacher_id,session_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [item.date, item.term, item.year, item.className,
         item.studentId, item.studentName,
         item.areaStatus || '', item.dutyStatus || '', item.flagStatus || '',
         effectiveTeacherId, sessionId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { status: 'success', message: `บันทึกสำเร็จ ${list.length} รายการ`, saved: list.length, sessionId };
}

async function getTodayMorningSummary([date, teacherId]) {
  const params = [date];
  let sql = `SELECT class,
             COUNT(CASE WHEN area_status IN ('มา','present') THEN 1 END) as area_ok,
             COUNT(CASE WHEN duty_status IN ('มา','present') THEN 1 END) as duty_ok,
             COUNT(CASE WHEN flag_status IN ('มา','present') THEN 1 END) as flag_ok,
             COUNT(*) as total
             FROM morning_activity WHERE date=$1`;
  if (teacherId) { params.push(teacherId); sql += ` AND teacher_id=$${params.length}`; }
  sql += ' GROUP BY class ORDER BY class';
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    className: r.class,
    areaOk: parseInt(r.area_ok),
    dutyOk: parseInt(r.duty_ok),
    flagOk: parseInt(r.flag_ok),
    total: parseInt(r.total),
  }));
}

module.exports = { getMorningActivityData, saveMorningActivityBatch, getTodayMorningSummary };
