'use strict';
/**
 * นี่คือ deployment แบบไหน — โรงเรียนจริง หรือเดโมสาธารณะ
 *
 * **เครื่องหมายอยู่ในฐานข้อมูล ไม่ใช่ใน env** โดยตั้งใจ
 *
 * สคริปต์ที่ล้างข้อมูล (db/seed-dev.js, db/seed-demo.js) เดิมกันไว้ด้วย
 * "DATABASE_URL ต้องชี้ localhost" ซึ่งพอมีเดโมบนคลาวด์ก็ต้องปลด
 * ถ้าปลดเป็น env var เช่น ALLOW_SEED=1 แปลว่าสิทธิ์ล้างฐานข้อมูลขึ้นกับ
 * ตัวแปรฝั่งคนรัน — ชี้ DATABASE_URL ผิดหน้าต่างเดียวคือข้อมูลครูและนักเรียนจริงหาย
 *
 * จึงย้ายการอนุญาตไปไว้ที่ **ฐานข้อมูลปลายทางเป็นคนบอกเองว่าตัวเองเป็นเดโม**
 * DB ของโรงเรียนจริงไม่มีแถวนี้ ต่อให้ env ถูกทุกตัวก็ยังล้างไม่ได้
 *
 * ทำเครื่องหมาย:  node scripts/mark-demo.js --yes
 */
const { query } = require('./db');

const KEY = 'instance';
const DEMO = 'demo';

/** true เฉพาะเมื่อ DB นั้นประกาศตัวเองว่าเป็นเดโม — อ่านสดเสมอ ไม่แคช */
async function isDemoDatabase() {
  const { rows } = await query(
    `SELECT value1 FROM system_settings WHERE key=$1 AND subkey=''`, [KEY]
  );
  return (rows[0] && rows[0].value1) === DEMO;
}

async function markDemo() {
  await query(
    `INSERT INTO system_settings(key, subkey, value1) VALUES($1,'',$2)
     ON CONFLICT(key, subkey) DO UPDATE SET value1=$2`, [KEY, DEMO]
  );
}

/**
 * บันทึกว่าเครื่องนี้เคยเริ่ม bootstrap แล้ว — เก็บไว้แม้ bootstrap จะล้มเหลว
 *
 * มีไว้เพื่อให้ "ลองใหม่ได้" โดยไม่ต้องผ่อนด่าน "ฐานข้อมูลต้องว่างเปล่า"
 * ถ้า seed พังกลางทาง DB จะเหลือข้อมูลค้าง แล้วรอบหน้าจะติดด่านตัวเอง
 * แถวนี้เป็นหลักฐานว่า **ข้อมูลทุกอย่างใน DB นี้เกิดจาก bootstrap ของเราเอง**
 * ฐานข้อมูลของโรงเรียนจริงไม่มีวันมีแถวนี้
 */
async function markBootstrapAttempted() {
  await query(
    `INSERT INTO system_settings(key, subkey, value1) VALUES($1,'bootstrap',$2)
     ON CONFLICT(key, subkey) DO UPDATE SET value1=$2`, [KEY, new Date().toISOString()]
  );
}

async function bootstrapAttempted() {
  const { rows } = await query(
    `SELECT 1 FROM system_settings WHERE key=$1 AND subkey='bootstrap'`, [KEY]
  );
  return rows.length > 0;
}

async function unmarkDemo() {
  await query(`DELETE FROM system_settings WHERE key=$1 AND subkey=''`, [KEY]);
}

/**
 * ด่านเดียวที่สคริปต์ล้างข้อมูลทุกตัวต้องผ่าน
 * ผ่านได้ 2 ทาง: DB อยู่บนเครื่องตัวเอง หรือ DB ประกาศตัวว่าเป็นเดโม
 */
async function assertSafeToWipe(scriptName) {
  let host = '';
  try { host = new URL(String(process.env.DATABASE_URL || '')).hostname; } catch (_) { /* ตกไป error */ }
  if (host === 'localhost' || host === '127.0.0.1') return 'localhost';

  let demo = false;
  try { demo = await isDemoDatabase(); } catch (_) { demo = false; }
  if (demo) return 'demo';

  console.error(`❌ ${scriptName}: ปฏิเสธการรัน — ฐานข้อมูลนี้ไม่ใช่ localhost และไม่ได้ทำเครื่องหมายว่าเป็นเดโม`);
  console.error(`   ตอนนี้ชี้ไปที่: ${host || '(อ่าน DATABASE_URL ไม่ได้)'}`);
  console.error(`   ถ้านี่คือเครื่องเดโมจริง ๆ ให้รัน: node scripts/mark-demo.js --yes`);
  process.exit(1);
}

module.exports = {
  isDemoDatabase, markDemo, unmarkDemo, assertSafeToWipe,
  markBootstrapAttempted, bootstrapAttempted,
};
