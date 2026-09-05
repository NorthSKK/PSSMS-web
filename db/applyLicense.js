'use strict';
/**
 * วันหมดอายุที่ผู้ขายตั้งมาให้ — ทำงานตอน boot
 *
 * ผู้ขายตั้ง `LICENSE_UNTIL` ที่ Railway แล้วสั่ง redeploy · **แอปของโรงเรียนเป็นคน
 * เขียนฐานข้อมูลเอง** ระบบหลังบ้านไม่เคยต่อ Postgres ของใคร (ADR 0001 ยังอยู่ครบ)
 *
 * เดิมตั้งด้วย `scripts/set-license.js` ที่ต้องมี `DATABASE_URL` ของโรงเรียนนั้นในมือ
 * ซึ่งแปลว่าต้องเปิด dashboard ทุกครั้ง · สคริปต์นั้นยังใช้ได้เหมือนเดิม
 *
 * ⚠️ **เขียนทับค่าที่มีอยู่เมื่อค่าต่างกัน** ต่างจาก `resetAdmin` ที่ทำครั้งเดียว —
 * วันหมดอายุเป็นของผู้ขาย ไม่ใช่ของโรงเรียน ถ้าโรงเรียนแก้เองในฐานข้อมูล
 * (ซึ่งทำได้ ระบบนี้เป็น honest-broker ไม่ใช่ DRM) ค่าที่ผู้ขายตั้งควรกลับมา
 *
 * ⚠️ `LICENSE_UNTIL=none` = ลบแถวทิ้ง แปลว่าไม่จำกัด (โรงเรียนเรา เดโม)
 */

const { query } = require('../lib/db');
const cache = require('../lib/cache');

const KEY = 'license';
const SUBKEY = 'until';

async function run() {
  const raw = String(process.env.LICENSE_UNTIL || '').trim();
  if (!raw) return null;

  const { rows } = await query(
    'SELECT value1 FROM system_settings WHERE key = $1 AND subkey = $2', [KEY, SUBKEY],
  );
  const current = rows.length ? String(rows[0].value1 || '') : null;

  if (raw === 'none') {
    if (current === null) return null;
    await query('DELETE FROM system_settings WHERE key = $1 AND subkey = $2', [KEY, SUBKEY]);
    cache.del('license_status');
    console.log('[license] ปลดวันหมดอายุแล้ว — ไม่จำกัด');
    return 'none';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    console.error(`[license] LICENSE_UNTIL="${raw}" ผิดรูป ต้องเป็น YYYY-MM-DD — ไม่ได้ตั้งอะไร`);
    return null;
  }
  if (raw === current) return null;

  await query(
    `INSERT INTO system_settings (key, subkey, value1) VALUES ($1, $2, $3)
     ON CONFLICT (key, subkey) DO UPDATE SET value1 = EXCLUDED.value1`,
    [KEY, SUBKEY, raw],
  );
  cache.del('license_status');
  console.log(`[license] ตั้งวันหมดอายุเป็น ${raw}`);
  return raw;
}

module.exports = { run };
