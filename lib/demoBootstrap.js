'use strict';
/**
 * ตั้งเครื่องเดโมครั้งแรกให้ตัวเอง
 *
 * เครื่องเดโมอยู่บนคลาวด์ ฐานข้อมูลไม่เปิดออกอินเทอร์เน็ต (และไม่ควรเปิด)
 * จะทำเครื่องหมาย + seed ครั้งแรกจึงต้องสั่งจากข้างในคอนเทนเนอร์เอง
 *
 * ด่านสองชั้น ต้องผ่านทั้งคู่:
 *   1. ตั้ง `DEMO_BOOTSTRAP=1` ไว้ที่ service นั้น — เจตนาชัด ไม่ใช่เผลอ
 *   2. **ฐานข้อมูลต้องว่างเปล่า** ยังไม่มีผู้ใช้สักคน
 *
 * ข้อ 2 คือข้อที่ทำให้ปลอดภัยจริง — ตั้ง env ผิดเครื่องก็ยังทำอะไรไม่ได้
 * เพราะ DB ของโรงเรียนที่ใช้งานอยู่มีคนเต็มไปหมด ล้างของที่ว่างอยู่แล้วไม่เสียอะไร
 *
 * ทำงานครั้งเดียวตลอดอายุเครื่อง — พอ seed เสร็จ DB ก็ไม่ว่างอีกต่อไป
 * รอบล้างประจำคืนหลังจากนั้นเป็นหน้าที่ของ lib/demoReset.js
 */
const path = require('path');
const { execFile } = require('child_process');
const { query } = require('./db');
const { isDemoDatabase, markDemo, unmarkDemo } = require('./instance');

function runSeed() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath, [path.join(__dirname, '../db/seed-demo.js')],
      { timeout: 5 * 60 * 1000 },
      (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).trim().slice(0, 500))) : resolve()
    );
  });
}

async function run() {
  if (process.env.DEMO_BOOTSTRAP !== '1') return;

  if (await isDemoDatabase()) return;   // ตั้งไปแล้วรอบก่อน

  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users`);
  if (rows[0].n > 0) {
    console.error(
      `[demo-bootstrap] ตั้ง DEMO_BOOTSTRAP=1 ไว้ แต่ฐานข้อมูลนี้มีผู้ใช้ ${rows[0].n} คนแล้ว — ไม่ทำอะไรทั้งสิ้น\n` +
      `                 ถ้านี่คือเครื่องโรงเรียนจริง ให้เอา DEMO_BOOTSTRAP ออก`
    );
    return;
  }

  console.log('[demo-bootstrap] ฐานข้อมูลว่าง — ตั้งเป็นเดโมและใส่ข้อมูลตั้งต้น');
  await markDemo();
  try {
    await runSeed();
    console.log('[demo-bootstrap] เรียบร้อย');
  } catch (e) {
    // seed ไม่ผ่านแล้วปล่อยเครื่องหมายค้างไว้ = DB ว่างที่ถูกล้างซ้ำได้ทุกคืนโดยไม่มีใครดู
    await unmarkDemo().catch(() => {});
    console.error('[demo-bootstrap] seed ล้มเหลว ถอนเครื่องหมายคืนแล้ว:', e.message);
  }
}

module.exports = { run };
