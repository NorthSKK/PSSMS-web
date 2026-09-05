'use strict';
/**
 * รีเซ็ตรหัสผ่าน `admin` ตามคำสั่งจากผู้ขาย — ทำงานตอน boot
 *
 * ผู้ขายตั้ง `RESET_ADMIN_PASSWORD` ที่ Railway แล้วสั่ง redeploy · **แอปของโรงเรียน
 * เป็นคนเขียนฐานข้อมูลเอง** ระบบหลังบ้านไม่เคยต่อ Postgres ของใคร (ADR 0001 ยังอยู่ครบ)
 *
 * ⚠️ **ทำครั้งเดียวต่อหนึ่งค่า** — จดลายนิ้วมือของรหัสที่ใช้ไปแล้วไว้ใน `system_settings`
 * ไม่งั้นทุก redeploy จะทับรหัสที่โรงเรียนเปลี่ยนเองกลับไปเป็นค่าเดิม
 * (env var ถอดออกเองไม่ได้จากในแอป — จึงต้องมีตัวจำว่าใช้ไปแล้ว)
 *
 * ⚠️ จดเป็น sha256 ไม่ใช่ตัวรหัส — `system_settings` ถูกอ่านออกไปหลายที่
 * (`getSystemConfig` เป็น endpoint สาธารณะ) รหัสจริงต้องไม่ไปโผล่ที่นั่น
 */

const crypto = require('crypto');
const { query } = require('../lib/db');
const adminIssued = require('./adminIssued');

const KEY = 'adminReset';
const SUBKEY = 'applied';

const fingerprint = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function run() {
  const password = String(process.env.RESET_ADMIN_PASSWORD || '').trim();
  if (!password) return null;

  const mark = fingerprint(password);
  const { rows } = await query(
    'SELECT value1 FROM system_settings WHERE key = $1 AND subkey = $2', [KEY, SUBKEY],
  );
  if (rows.length && rows[0].value1 === mark) return null;   // ค่านี้ใช้ไปแล้ว

  const { rowCount } = await query(
    "UPDATE users SET password = $1 WHERE username = 'admin'", [password],
  );
  if (rowCount === 0) {
    // ไม่มีบัญชี admin ให้รีเซ็ต — สร้างให้ ไม่งั้นคำสั่งรีเซ็ตจะเงียบหายไปเฉย ๆ
    await query(
      `INSERT INTO users (username, password, full_name, role, status)
       VALUES ('admin', $1, 'ผู้ดูแลระบบ', 'Admin', 'ปกติ')
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password`,
      [password],
    );
  }

  await query(
    `INSERT INTO system_settings (key, subkey, value1) VALUES ($1, $2, $3)
     ON CONFLICT (key, subkey) DO UPDATE SET value1 = EXCLUDED.value1`,
    [KEY, SUBKEY, mark],
  );
  // รหัสใบนี้ผู้ขายเป็นคนออก — การ์ดตั้งค่าเริ่มต้นต้องกลับมาเตือนให้เปลี่ยนอีกครั้ง
  await adminIssued.record(password);

  console.log('[admin] รีเซ็ตรหัสผ่าน admin ตามคำสั่งจากผู้ขายแล้ว');
  return 'admin';
}

module.exports = { run, fingerprint };
