'use strict';
/**
 * บัญชีผู้ดูแลระบบใบแรกของโรงเรียนใหม่
 *
 * `db/schema.sql` สร้างแต่ตาราง ไม่ได้ใส่ผู้ใช้ให้สักคน — โรงเรียนที่เพิ่งติดตั้งเสร็จ
 * จึงเปิดเว็บได้แต่ **ล็อกอินไม่ได้เลย** ไม่มีทางเข้าไปตั้งค่าอะไรได้ทั้งนั้น
 * (คู่มือเคยเขียนว่า "ฐานข้อมูลใหม่มี admin/1234 มาให้" ซึ่งไม่เคยจริง)
 *
 * ⚠️ **สร้างเมื่อตาราง `users` ว่างเปล่าเท่านั้น** ไม่ใช่ "ถ้าไม่มี admin" —
 * โรงเรียนที่ลบบัญชี admin ทิ้งโดยตั้งใจแล้วใช้บัญชีอื่นแทน ต้องไม่ถูกยัดคืนทุก deploy
 *
 * ⚠️ **ไม่มีรหัสผ่าน default** ต้องตั้ง `INITIAL_ADMIN_PASSWORD` เอง ไม่งั้นไม่สร้าง
 * รหัสที่เดาได้บนเว็บที่เปิดสู่อินเทอร์เน็ตตั้งแต่นาทีแรกอันตรายกว่าการที่ยังล็อกอินไม่ได้
 */

const { query } = require('../lib/db');

async function run() {
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0) return null;

  const password = String(process.env.INITIAL_ADMIN_PASSWORD || '').trim();
  if (!password) {
    console.error('[admin] ยังไม่มีผู้ใช้สักคนและไม่ได้ตั้ง INITIAL_ADMIN_PASSWORD '
      + '— ยังไม่มีใครล็อกอินเข้าระบบนี้ได้');
    return null;
  }

  await query(
    `INSERT INTO users (username, password, full_name, role, status)
     VALUES ('admin', $1, 'ผู้ดูแลระบบ', 'Admin', 'ปกติ')
     ON CONFLICT (username) DO NOTHING`,
    [password],
  );
  console.log('[admin] สร้างบัญชี admin ใบแรกให้แล้ว — เปลี่ยนรหัสผ่านก่อนส่งมอบ');
  return 'admin';
}

module.exports = { run };
