/**
 * งานสารบรรณ — ทะเบียนเอกสารกลางของโรงเรียน
 *
 * ⚠️ ตัวตนของผู้เรียกมาจาก JWT เท่านั้น **ห้ามรับ requester/role จาก client**
 *    เดิม getSarabunHistory รับ role มาจาก args ทำให้ใครก็ตามที่ล็อกอินได้
 *    ส่ง role='TEACHER' แล้วอ่านทะเบียนทั้งโรงเรียน
 *
 * ครูและ Admin เห็นทุกรายการและเปิดไฟล์แนบได้ทั้งหมด — เป็นทะเบียนกลางของงานธุรการ
 * **ไม่ใช่ที่เก็บเอกสารลับ** (เรื่องบุคคล เงินเดือน วินัย ไม่ควรแนบที่นี่)
 *
 * **เขียน (แก้ไข/แนบไฟล์) ได้เฉพาะผู้รับผิดชอบเอกสารหรือ Admin** — ดู _assertOwnsSarabun
 * requester ว่าง (ข้อมูลเก่า/นำเข้า) สงวนให้ Admin แก้ (หลักเดียวกับ budgets.created_by)
 */
const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');
const storage = require('../lib/storage');
const { schoolToday } = require('../lib/schoolDate');

// 10MB — หนังสือราชการสแกนไม่กี่หน้า หรือรูปถ่ายจากมือถือ ไม่ใช่หนังสือทั้งเล่ม
const MAX_ATTACH_MB = 10;

/**
 * ผู้รับผิดชอบเอกสาร — คืน `{ name, id }`
 *   name = ชื่อที่แสดงในทะเบียน · id = users.username ที่เป็นเจ้าของจริง (อาจเป็น null)
 *
 * Admin ระบุแทนคนอื่นได้ (ธุรการกรอกให้ครู) ครูทั่วไปเป็นตัวเองเสมอ
 * ชื่อที่ Admin พิมพ์มา หาชื่อเต็มใน users ให้ด้วย — ตรงเมื่อไหร่แถวนั้นได้เจ้าของทันที
 * (นี่คือทางแก้แถวเก่าที่ชื่อเป็นชื่อย่อ: Admin แก้ทะเบียนแล้วเลือกชื่อเต็มให้ถูก)
 * ไม่ตรง = ชื่ออิสระที่ไม่มีใครเป็นเจ้าของ → id = null สงวนให้ Admin แก้
 *
 * อ่านชื่อจาก users.full_name ไม่ใช่ user.name ใน JWT — token ออกตอนล็อกอินและอยู่ได้
 * 90 วัน ครูที่เปลี่ยนชื่อ-สกุลจะได้ชื่อเก่าติดไปกับเอกสารใหม่
 * (หลักเดียวกับระดับชั้นนักเรียนใน functions/mediaCards.js)
 */
async function resolveRequester(user, given) {
  if (isAdmin(user) && given) {
    const name = String(given);
    const { rows } = await query(
      `SELECT username FROM users WHERE trim(full_name)=trim($1) LIMIT 1`, [name]
    );
    return { name, id: (rows[0] && rows[0].username) || null };
  }
  const { rows } = await query(
    `SELECT full_name FROM users WHERE username=$1`, [String(user?.id || '')]
  );
  return {
    name: String((rows[0] && rows[0].full_name) || user?.name || ''),
    id: String(user?.id || '') || null,
  };
}

/**
 * เจ้าของเอกสาร = แถวที่ requester_id ตรงกับ username ของผู้เรียก — Admin ผ่านเสมอ
 *
 * **ตัดสินที่ requester_id เท่านั้นเมื่อมีค่า ไม่ดูชื่อเลย** — ครูที่เปลี่ยนชื่อ-สกุล
 * ต้องยังเป็นเจ้าของเอกสารเก่าของตัวเอง นั่นคือเหตุผลทั้งหมดของคอลัมน์นี้
 *
 * requester_id ว่าง = แถวเก่าก่อน migration ที่ backfill ด้วยชื่อไม่ตรง (ชื่อย่ออย่าง
 * `ครูพิสิษฐ์` หรือสองคนในช่องเดียว) → ตกไปใช้กติกาเดิม เทียบ requester กับชื่อจริงสด
 * เผื่อชื่อบังเอิญตรง · ไม่ตรงหรือว่าง = Admin เท่านั้น (หลักเดียวกับ budgets.created_by)
 *
 * ⚠️ ห้ามเทียบกับค่าจาก payload — row ต้องมาจาก DB และชื่อผู้เรียก query สดจาก users
 */
async function _assertOwnsSarabun(user, row, msg) {
  if (isAdmin(user)) return;
  const callerId = String(user?.id || '').trim();
  const ownerId = String((row && row.requester_id) || '').trim();
  if (ownerId) {
    if (ownerId !== callerId) throw new Error(msg);
    return;
  }
  const owner = String((row && row.requester) || '').trim();
  if (!owner) throw new Error(msg);
  const { rows } = await query(
    `SELECT full_name FROM users WHERE username=$1`, [callerId]
  );
  const name = String((rows[0] && rows[0].full_name) || '').trim();
  if (!name || name !== owner) throw new Error(msg);
}

async function saveSarabun([data], user) {
  const d = data || {};
  const requester = await resolveRequester(user, d.requester);
  if (d.id) {
    const existing = await query(
      `SELECT requester, requester_id FROM sarabun WHERE id=$1`, [d.id]);
    if (!existing.rows.length) throw new Error('ไม่พบทะเบียนเอกสารนี้');
    // ตรวจกับ "แถวเดิมใน DB" เสมอ ก่อนจะเขียนทับด้วยผู้รับผิดชอบที่เพิ่ง resolve
    await _assertOwnsSarabun(user, existing.rows[0],
      'แก้ไขได้เฉพาะผู้รับผิดชอบเอกสารนี้');
    await query(
      `UPDATE sarabun SET doc_type=$1,doc_number=$2,subject=$3,requester=$4,
       target_date=$5,status=$6,file_url=$7,year=$8,requester_id=$9 WHERE id=$10`,
      [d.docType||'', d.docNumber||'', d.subject||'', requester.name,
       d.targetDate||null, d.status||'รอดำเนินการ', d.fileURL||'', d.year||'',
       requester.id, d.id]
    );
  } else {
    await query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year,requester_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [d.docType||'', d.docNumber||'', d.subject||'', requester.name,
       d.targetDate||null, d.status||'รอดำเนินการ', d.fileURL||'', d.year||'',
       requester.id]
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
 * เฉพาะผู้รับผิดชอบเอกสารหรือ Admin (_assertOwnsSarabun) — ครูคนอื่นอ่านได้อย่างเดียว
 * แนบทับ: อัปไฟล์ใหม่ให้สำเร็จก่อน แล้วค่อยลบของเก่า (ลบก่อนแล้วอัปพัง = เสียของเดิมฟรี)
 */
async function attachSarabunFile(id, file, user) {
  const docId = parseInt(id, 10);
  if (!Number.isInteger(docId)) throw new Error('ไม่พบทะเบียนเอกสารนี้');

  const { rows } = await query(
    `SELECT id, file_key, requester, requester_id FROM sarabun WHERE id=$1`, [docId]);
  if (!rows.length) throw new Error('ไม่พบทะเบียนเอกสารนี้');
  const oldKey = rows[0].file_key;

  // ตรวจสิทธิ์ก่อนเขียนไฟล์เสมอ — เขียนก่อนแล้วค่อยเช็ค = ไฟล์กำพร้าเมื่อโดนปฏิเสธ
  await _assertOwnsSarabun(user, rows[0], 'แนบไฟล์ได้เฉพาะผู้รับผิดชอบเอกสารนี้');

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
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,file_url,year,requester_id)
       SELECT $1, n, $2, $3, $4, 'รอดำเนินการ', '', $5, $6 FROM unnest($7::text[]) AS n`,
      [docType, subject, requester.name, targetDate, year, requester.id, numbers]
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
