const { query } = require('../lib/db');

module.exports = async function getSarabunHistory([userName, role]) {
  const roleUpper = String(role || '').toUpperCase();
  const isAdmin = roleUpper === 'ADMIN' || roleUpper === 'TEACHER';
  const params = [];
  let sql = `SELECT id, to_char(timestamp, 'YYYY-MM-DD HH24:MI') as timestamp,
                    doc_type, doc_number, subject, requester,
                    to_char(target_date, 'YYYY-MM-DD') as target_date,
                    status, file_url, year
             FROM sarabun WHERE (doc_number IS NOT NULL OR doc_type IS NOT NULL)`;

  if (!isAdmin && userName) {
    params.push(userName);
    sql += ` AND requester=$${params.length}`;
  }
  sql += ' ORDER BY id DESC';

  const { rows } = await query(sql, params);
  return rows.map(r => ({
    id:         r.id,
    timestamp:  r.timestamp   || '',
    docType:    r.doc_type    || '',
    docNumber:  r.doc_number  || '',
    subject:    r.subject     || '',
    requester:  r.requester   || '',
    targetDate: r.target_date || '',
    status:     r.status      || '',
    fileURL:    r.file_url    || '',
    year:       r.year        || '',
  }));
};
