const { query } = require('../lib/db');

async function saveSarabun([data]) {
  const d = data || {};
  if (d.id) {
    await query(
      `UPDATE sarabun SET doc_type=$1,doc_number=$2,subject=$3,requester=$4,
       target_date=$5,status=$6,file_url=$7,year=$8 WHERE id=$9`,
      [d.docType||'', d.docNumber||'', d.subject||'', d.requester||'',
       d.targetDate||null, d.status||'รอดำเนินการ', d.fileURL||'', d.year||'', d.id]
    );
  } else {
    await query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.docType||'', d.docNumber||'', d.subject||'', d.requester||'',
       d.targetDate||null, d.status||'รอดำเนินการ', d.fileURL||'', d.year||'']
    );
  }
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function deleteSarabun([id]) {
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
  return { status: 'success', message: 'ลบสำเร็จ' };
}

async function requestSarabunNumber([payload]) {
  const d = payload || {};
  const docType = d.docType || '';
  const year = d.year || String(new Date().getFullYear() + 543);
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent requests to prevent duplicate doc numbers
    await client.query('LOCK TABLE sarabun IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(
      `SELECT doc_number FROM sarabun WHERE doc_type=$1 AND year=$2 ORDER BY id DESC LIMIT 1`,
      [docType, year]
    );
    let nextNum = 1;
    if (rows.length > 0) {
      const last = String(rows[0].doc_number || '').match(/(\d+)/);
      if (last) nextNum = parseInt(last[1]) + 1;
    }
    const docNumber = `${nextNum}/${year}`;
    const targetDate = (d.targetDate && d.targetDate !== '-') ? d.targetDate : null;
    await client.query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [docType, docNumber, d.subject || '', d.requester || '',
       targetDate, 'รอดำเนินการ', '', year]
    );
    await client.query('COMMIT');
    return { status: 'success', message: 'บันทึกสำเร็จ', docNumber };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { saveSarabun, deleteSarabun, requestSarabunNumber };
