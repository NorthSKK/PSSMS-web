'use strict';
/**
 * ล้างเดโมกลับเป็นข้อมูลตั้งต้นทุกคืน
 *
 * เดโมเปิดให้ใครก็ได้เข้ามาลองกดทุกปุ่ม ถ้าไม่ล้าง ภายในสัปดาห์เดียวมันจะเต็มไป
 * ด้วยข้อมูลขยะและคำหยาบ แล้วกลายเป็นหน้าที่แย่ที่สุดของเว็บขายแทนที่จะเป็นหน้าที่ดีที่สุด
 *
 * ตั้งเวลาไว้ในตัวแอปเอง ไม่ใช้ cron แยก เพราะ 1 โรงเรียน = 1 deployment อยู่แล้ว
 * การมี service เพิ่มอีกตัวแค่เพื่อยิง seed คืนละครั้งไม่คุ้มกับที่ต้องดูแล
 *
 * ⚠️ ตัวนี้ล้างฐานข้อมูล — เริ่มทำงานเฉพาะเมื่อ DB ประกาศตัวว่าเป็นเดโม (lib/instance.js)
 *    ไม่ได้ดูจาก env ใด ๆ ทั้งสิ้น
 */
const path = require('path');
const { execFile } = require('child_process');
const { isDemoDatabase } = require('./instance');

const RESET_HOUR = 3;             // ตี 3 ตามเวลาไทย — ไม่มีใครใช้
const TICK_MS = 10 * 60 * 1000;   // เช็คทุก 10 นาที ไม่ต้องเป๊ะระดับนาที

let lastResetDay = null;
let running = false;

/** วันที่ปัจจุบันตามเวลาไทย เป็น 'YYYY-MM-DD' และชั่วโมง 0-23 */
function bangkokNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
}

function runSeed() {
  return new Promise((resolve) => {
    execFile(
      process.execPath, [path.join(__dirname, '../db/seed-demo.js')],
      { timeout: 5 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) console.error('[demo-reset] ล้มเหลว:', (stderr || err.message).trim().slice(0, 500));
        else console.log('[demo-reset] ล้างข้อมูลเดโมเรียบร้อย');
        resolve();
      }
    );
  });
}

async function tick() {
  if (running) return;
  const { day, hour } = bangkokNow();
  if (hour !== RESET_HOUR || lastResetDay === day) return;
  lastResetDay = day;   // ตั้งก่อนรัน — seed พังก็ไม่วนรันซ้ำทุก 10 นาทีทั้งชั่วโมง
  running = true;
  try { await runSeed(); } finally { running = false; }
}

/** เรียกจาก server.js — ไม่ทำอะไรเลยถ้าไม่ใช่เดโม */
async function start() {
  let demo = false;
  try { demo = await isDemoDatabase(); } catch (_) { return; }
  if (!demo) return;

  // เพิ่งบูตขึ้นมา ถือว่าวันนี้ล้างแล้ว กัน deploy ตอนตี 3 แล้วล้างทับคนที่กำลังลองอยู่
  lastResetDay = bangkokNow().day;
  const timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  timer.unref();
  console.log(`[demo-reset] เดโม — จะล้างข้อมูลทุกวันเวลา ${RESET_HOUR}:00 น. (เวลาไทย)`);
}

module.exports = { start, bangkokNow };
