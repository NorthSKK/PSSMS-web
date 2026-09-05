'use strict';
/**
 * ลายนิ้วมือของรหัสผ่าน `admin` ที่ **ผู้ขายเป็นคนออกให้**
 *
 * ระบบหลังบ้านสร้างโรงเรียนใหม่แล้วสุ่มรหัสให้ใบหนึ่ง ส่งให้ลูกค้าไปพร้อมลิงก์
 * รหัสใบนั้นเดินผ่านมือคนและแชทมาก่อนถึงมือแอดมินโรงเรียน — จึงต้องถูกเปลี่ยน
 * เป็นอย่างแรกที่เข้าระบบได้ · การ์ด "รายการตั้งค่าเริ่มต้น" ใช้ค่านี้ตัดสินว่า
 * เปลี่ยนแล้วหรือยัง
 *
 * เดิมข้อนั้นเทียบกับ `'1234'` ตรง ๆ ซึ่งเลิกจริงไปตั้งแต่ `bootstrapAdmin` บังคับ
 * ให้ตั้ง `INITIAL_ADMIN_PASSWORD` เอง — โรงเรียนใหม่ทุกแห่งจึงเห็นข้อนี้ติ๊ก ✓
 * ตั้งแต่วินาทีแรกทั้งที่ยังใช้รหัสที่เราส่งไปทางไลน์อยู่
 *
 * ⚠️ จดเป็น sha256 ไม่ใช่ตัวรหัส — `system_settings` ถูกอ่านออกไปหลายที่
 * (`getSystemConfig` เป็น endpoint สาธารณะ)
 */

const crypto = require('crypto');
const { query } = require('../lib/db');

const KEY = 'adminIssued';
const SUBKEY = 'fingerprint';

const fingerprint = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** จดว่ารหัสใบนี้คือใบที่ผู้ขายออกให้ (เรียกทุกครั้งที่ตั้งรหัสจาก env) */
async function record(password) {
  await query(
    `INSERT INTO system_settings (key, subkey, value1) VALUES ($1, $2, $3)
     ON CONFLICT (key, subkey) DO UPDATE SET value1 = EXCLUDED.value1`,
    [KEY, SUBKEY, fingerprint(password)],
  );
}

/** ลายนิ้วมือที่จดไว้ หรือ `null` ถ้าไม่เคยมี (โรงเรียนที่ติดตั้งด้วยมือก่อนหน้านี้) */
async function read() {
  const { rows } = await query(
    'SELECT value1 FROM system_settings WHERE key = $1 AND subkey = $2', [KEY, SUBKEY],
  );
  return rows.length ? String(rows[0].value1 || '') || null : null;
}

module.exports = { record, read, fingerprint, KEY, SUBKEY };
