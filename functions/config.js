const { query } = require('../lib/db');
const cache = require('../lib/cache');

async function saveSystemConfig([configData]) {
  const c = configData || {};

  if (c.term && c.year) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('Active','Term',$1,$2)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1, value2=$2`,
      [String(c.term), String(c.year)]
    );
  }
  if (c.schoolName) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1) VALUES('school_name','',$1)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1`,
      [c.schoolName]
    );
  }
  if (c.schoolLogo !== undefined) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1) VALUES('school_logo','',$1)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1`,
      [c.schoolLogo]
    );
  }
  if (c.termStart || c.termEnd) {
    const t = c.term || '1';
    const y = c.year || '2568';
    await query(
      `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('TermData',$1,$2,$3)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$2, value2=$3`,
      [`${t}_${y}`, c.termStart || '', c.termEnd || '']
    );
  }

  cache.del('system_config');
  return { status: 'success', message: 'บันทึกการตั้งค่าสำเร็จ' };
}

async function saveCalendarEvent([eventData]) {
  const e = eventData || {};
  if (e.id) {
    await query(
      `INSERT INTO calendar_events(id,title,start_date,end_date,color,description,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET title=$2,start_date=$3,end_date=$4,color=$5,description=$6`,
      [e.id, e.title || '', e.start || e.startDate || '', e.end || e.endDate || e.start || '',
       e.color || '#3b82f6', e.description || '', e.createdBy || '']
    );
  } else {
    await query(
      `INSERT INTO calendar_events(title,start_date,end_date,color,description,created_by)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [e.title || '', e.start || e.startDate || '', e.end || e.endDate || e.start || '',
       e.color || '#3b82f6', e.description || '', e.createdBy || '']
    );
  }
  cache.del('calendar_events_all');
  return { status: 'success', message: 'บันทึกกิจกรรมสำเร็จ' };
}

async function deleteCalendarEvent([eventId]) {
  await query(`DELETE FROM calendar_events WHERE id=$1`, [eventId]);
  cache.del('calendar_events_all');
  return { status: 'success', message: 'ลบกิจกรรมสำเร็จ' };
}

async function importCalendarCSV([rows]) {
  if (!Array.isArray(rows) || rows.length === 0) return { status: 'success', message: 'นำเข้า 0 รายการ', imported: 0 };
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      if (!r.title || !r.start) continue;
      await client.query(
        `INSERT INTO calendar_events(title,start_date,end_date,color,description)
         VALUES($1,$2,$3,$4,$5)`,
        [r.title, r.start, r.end || r.start, r.color || '#3b82f6', r.description || '']
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
  cache.del('calendar_events_all');
  return { status: 'success', message: `นำเข้าสำเร็จ ${count} รายการ`, imported: count };
}

module.exports = { saveSystemConfig, saveCalendarEvent, deleteCalendarEvent, importCalendarCSV };
