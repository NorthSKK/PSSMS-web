/**
 * งานสารบรรณ — ทะเบียนเอกสารกลางของโรงเรียน
 *
 * ⚠️ ตัวตนของผู้เรียกมาจาก JWT เท่านั้น **ห้ามรับ requester/role จาก client**
 *    เดิม getSarabunHistory รับ role มาจาก args ทำให้ใครก็ตามที่ล็อกอินได้
 *    ส่ง role='TEACHER' แล้วอ่านทะเบียนทั้งโรงเรียน
 *
 * ครูและ Admin เห็นทุกรายการและเปิดไฟล์แนบได้ทั้งหมด — เป็นทะเบียนกลางของงานธุรการ
 * **ไม่ใช่ที่เก็บเอกสารลับ** (เรื่องบุคคล เงินเดือน วินัย ไม่ควรแนบที่นี่)
 */
const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');
const storage = require('../lib/storage');
const { schoolToday } = require('../lib/schoolDate');

// 10MB — หนังสือราชการสแกนไม่กี่หน้า หรือรูปถ่ายจากมือถือ ไม่ใช่หนังสือทั้งเล่ม
const MAX_ATTACH_MB = 10;

/**
 * ชื่อผู้ขอ — Admin ระบุแทนคนอื่นได้ (ธุรการกรอกให้ครู) ครูทั่วไปเป็นตัวเองเสมอ
 *
 * อ่านชื่อจาก users.full_name ไม่ใช่ user.name ใน JWT — token ออกตอนล็อกอินและอยู่ได้
 * 90 วัน ครูที่เปลี่ยนชื่อ-สกุลจะได้ชื่อเก่าติดไปกับเอกสารใหม่
 * (หลักเดียวกับระดับชั้นนักเรียนใน functions/mediaCards.js)
 */
async function resolveRequester(user, given) {
  if (isAdmin(user) && given) return String(given);
  const { rows } = await query(
    `SELECT full_name FROM users WHERE username=$1`, [String(user?.id || '')]
  );
  return String((rows[0] && rows[0].full_name) || user?.name || '');
}

async function saveSarabun([data], user) {
  const d = data || {};
  const requester = await resolveRequester(user, d.requester);
  if (d.id) {
    await query(
      `UPDATE sarabun SET doc_type=$1,doc_number=$2,subject=$3,requester=$4,
       target_date=$5,status=$6,file_url=$7,year=$8 WHERE id=$9`,
      [d.docType||'', d.docNumber||'', d.subject||'', requester,
       d.targetDate||null, d.status||'รอดำเนินการ', d.fileURL||'', d.year||'', d.id]
    );
  } else {
    await query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [d.docType||'', d.docNumber||'', d.subject||'', requester,
       d.targetDate||null, d.status||'รอดำเนินการ', d.fileURL||'', d.year||'']
    );
  }
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

/**
 * ลบทะเบียนเอกสาร (ADMIN_ONLY) — **ลบไฟล์ก่อนแล้วค่อยลบแถว**
 * สลับลำดับเมื่อไหร่ได้ไฟล์กำพร้าที่ไม่มีอะไรชี้ถึงตลอดกาล
 */
async function deleteSarabun([id]) {
  const { rows } = await query(`SELECT file_key FROM sarabun WHERE id=$1`, [id]);
  const fileKey = rows[0] && rows[0].file_key;
  if (fileKey) {
    try {
      await storage.remove(fileKey);
    } catch (err) {
      throw new Error('ลบไฟล์แนบไม่สำเร็จ จึงยังไม่ลบทะเบียน: ' + err.message);
    }
  }
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
  return { status: 'success', message: 'ลบสำเร็จ' };
}

/**
 * แนบไฟล์ — เรียกจาก routes/media.js เท่านั้น (multipart ไม่ผ่าน /api/gas)
 * แนบทับ: อัปไฟล์ใหม่ให้สำเร็จก่อน แล้วค่อยลบของเก่า (ลบก่อนแล้วอัปพัง = เสียของเดิมฟรี)
 */
async function attachSarabunFile(id, file, user) {
  const docId = parseInt(id, 10);
  if (!Number.isInteger(docId)) throw new Error('ไม่พบทะเบียนเอกสารนี้');

  const { rows } = await query(`SELECT id, file_key FROM sarabun WHERE id=$1`, [docId]);
  if (!rows.length) throw new Error('ไม่พบทะเบียนเอกสารนี้');
  const oldKey = rows[0].file_key;

  const saved = await storage.put({ buffer: file.buffer, ext: file.detectedExt });
  try {
    await query(
      `UPDATE sarabun SET file_key=$1, file_name=$2, file_size=$3 WHERE id=$4`,
      [saved.key, file.originalname || ('เอกสาร.' + file.detectedExt), saved.size, docId]
    );
  } catch (err) {
    await storage.remove(saved.key).catch(() => {}); // อย่าปล่อยไฟล์กำพร้า
    throw err;
  }
  if (oldKey && oldKey !== saved.key) await storage.remove(oldKey).catch(() => {});

  return { status: 'success', message: 'แนบไฟล์เรียบร้อย', fileName: file.originalname };
}

/** ลิงก์เปิดไฟล์แนบ อายุสั้น — ครูและ Admin เปิดได้ทุกใบ (ทะเบียนกลาง ดูหมายเหตุหัวไฟล์) */
async function getSarabunFileTicket([id], user) {
  const docId = parseInt(id, 10);
  if (!Number.isInteger(docId)) throw new Error('ไม่พบทะเบียนเอกสารนี้');
  const { rows } = await query(
    `SELECT id, file_key, file_name FROM sarabun WHERE id=$1`, [docId]
  );
  const row = rows[0];
  if (!row || !row.file_key) throw new Error('ทะเบียนนี้ไม่มีไฟล์แนบ');

  const url = await storage.getFileUrl({
    kind: 'sarabun', id: docId, key: row.file_key, filename: row.file_name, user,
  });
  return { url };
}

/**
 * ขอเลขทะเบียนสารบรรณ — ทีละเลข หรือรันเป็นชุด
 *
 * เกียรติบัตรขอเป็นชุด (ฟอร์มมีช่อง "จำนวน (ฉบับ)" ให้เฉพาะประเภทนี้ ปุ่มเขียนว่า
 * "รันเลขชุด") เดิม server ไม่เคยอ่าน d.amount เลย ขอ 25 ใบจึงได้เลขเดียว
 * แล้วอีก 24 ใบไม่มีเลขในทะเบียน
 *
 * ทั้งชุดออกใน transaction เดียวใต้ LOCK เดิม — ขอพร้อมกันสองคนต้องไม่ได้เลขทับกัน
 * และถ้าล้มกลางทางต้องไม่เหลือเลขค้างครึ่ง ๆ ในทะเบียน
 */
const MAX_BATCH = 500;   // ตรงกับ max ของช่องกรอกใน src/Page_General.html

async function requestSarabunNumber([payload], user) {
  const d = payload || {};
  const docType = d.docType || '';
  // ปี พ.ศ. ต้องคิดตามเวลาไทย — getFullYear() ใช้ TZ ของ process (UTC บน Railway)
  // ช่วง 1 ม.ค. 00:00-07:00 จะได้ปีเก่า แล้วเลขทะเบียนหนังสือราชการผิดปีทั้งชุด
  const year = d.year || String(Number(schoolToday().slice(0, 4)) + 543);

  // เผื่อ client เก่าหรือค่าเพี้ยน — ปัดเข้าช่วงที่รับได้เสมอ ไม่ปล่อยให้สร้างหมื่นแถว
  let amount = parseInt(d.amount, 10);
  if (!Number.isFinite(amount) || amount < 1) amount = 1;
  if (amount > MAX_BATCH) amount = MAX_BATCH;

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

    const targetDate = (d.targetDate && d.targetDate !== '-') ? d.targetDate : null;
    const requester = await resolveRequester(user, d.requester);
    const subject = d.subject || '';

    const numbers = [];
    for (let k = 0; k < amount; k++) numbers.push(`${nextNum + k}/${year}`);

    // ใส่ทีเดียวทั้งชุด — 500 แถวคือ 500 round trip ถ้ายิงทีละใบ
    await client.query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year)
       SELECT $1, n, $2, $3, $4, 'รอดำเนินการ', '', $5 FROM unnest($6::text[]) AS n`,
      [docType, subject, requester, targetDate, year, numbers]
    );
    await client.query('COMMIT');

    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    return {
      status: 'success',
      message: amount > 1 ? `บันทึกสำเร็จ ${amount} เลข` : 'บันทึกสำเร็จ',
      // docNumber ต้องคงเป็นเลขเดียวเสมอ — client เก่าเอาไปแสดงตรง ๆ
      docNumber: amount > 1 ? `${nextNum}-${nextNum + amount - 1}/${year}` : first,
      firstNumber: first,
      lastNumber: last,
      count: amount,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  saveSarabun, deleteSarabun, requestSarabunNumber,
  attachSarabunFile, getSarabunFileTicket,
  MAX_ATTACH_MB,
};
