const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');

/**
 * ทะเบียนสารบรรณ — ครูและ Admin เห็นทุกรายการ (ทะเบียนกลางของงานธุรการ)
 *
 * ⚠️ ตัวตนมาจาก JWT เท่านั้น **ห้ามกลับไปรับ userName/role จาก args**
 *    เดิมรับจาก client ทำให้ใครก็ตามที่ล็อกอินได้ส่ง role='TEACHER' แล้วอ่านทั้งโรงเรียน
 *    ตัวฟังก์ชันอยู่ใน TEACHER_OR_ADMIN แล้ว แต่ยังกรองซ้ำที่นี่ไม่ให้พึ่ง allowlist อย่างเดียว
 */
module.exports = async function getSarabunHistory(_args, user) {
  const role = String(user?.role || '').trim().toUpperCase();
  const admin = isAdmin(user);
  const staff = admin || role === 'TEACHER';

  // ชื่อจริงสดสำหรับธง mine (เขียนได้ไหม) — query ครั้งเดียว ไม่ใช่ต่อแถว
  // Admin ไม่ต้องถาม (mine=true ทุกแถว) · requester ว่าง = ของ Admin เท่านั้น
  let callerName = '';
  if (!admin) {
    const r = await query(
      `SELECT full_name FROM users WHERE username=$1`, [String(user?.id || '')]
    );
    callerName = String((r.rows[0] && r.rows[0].full_name) || '').trim();
  }

  const params = [];
  let sql = `SELECT id, to_char(timestamp, 'YYYY-MM-DD HH24:MI') as timestamp,
                    doc_type, doc_number, subject, requester,
                    to_char(target_date, 'YYYY-MM-DD') as target_date,
                    status, file_url, file_key, file_name, file_size, year
             FROM sarabun WHERE (doc_number IS NOT NULL OR doc_type IS NOT NULL)`;

  if (!staff) {
    params.push(String(user?.name || ''));
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
    fileName:   r.file_name   || '',
    fileSize:   r.file_size == null ? null : Number(r.file_size),
    hasFile:    !!r.file_key,
    year:       r.year        || '',
    // ผู้เรียกเขียนแถวนี้ได้ไหม (แก้ไข/แนบไฟล์) — กติกาเดียวกับ _assertOwnsSarabun
    mine:       admin || (!!callerName && String(r.requester || '').trim() === callerName),
  }));
};
