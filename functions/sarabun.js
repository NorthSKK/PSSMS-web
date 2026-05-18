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
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

module.exports = { saveSarabun, deleteSarabun };
