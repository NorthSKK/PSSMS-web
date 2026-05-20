const { query } = require('../lib/db');

async function getMorningActivityData([date, className]) {
  const { rows } = await query(
    `SELECT id, student_id, student_name, area_status, duty_status, flag_status, session_id
     FROM morning_activity WHERE date=$1 AND class=$2 ORDER BY student_id`,
    [date, className]
  );
  return rows.map(r => ({
    rowIdx: r.id,
    studentId: r.student_id,
    studentName: r.student_name || '',
    areaStatus: r.area_status || '',
    dutyStatus: r.duty_status || '',
    flagStatus: r.flag_status || '',
    sessionId: r.session_id || '',
  }));
}

async function saveMorningActivityBatch([payload]) {
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
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM morning_activity WHERE session_id=$1`, [sessionId]);
    for (const item of list) {
      await client.query(
        `INSERT INTO morning_activity(date,term,year,class,student_id,student_name,area_status,duty_status,flag_status,teacher_id,session_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [item.date, item.term, item.year, item.className,
         item.studentId, item.studentName,
         item.areaStatus || '', item.dutyStatus || '', item.flagStatus || '',
         item.teacherId || '', sessionId]
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
