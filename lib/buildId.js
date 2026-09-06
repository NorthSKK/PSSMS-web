'use strict';
/**
 * รหัสรุ่นของโค้ดที่กำลังรัน — ใช้เป็นส่วนหนึ่งของ cache key ฝั่ง client
 *
 * ทำไมต้องมี: `Scripts_Core.html` cache HTML ของแต่ละหน้าไว้ใน sessionStorage 30 นาที
 * ส่วนไฟล์ JS/CSS เสิร์ฟแบบ no-store คือใหม่เสมอ · หลัง deploy ที่แก้ markup
 * เบราว์เซอร์ที่เปิดค้างอยู่จะได้ **JS ใหม่คู่กับ HTML เก่า** แล้วพังเงียบ ๆ
 * (เจอจริงตอนเปลี่ยน id `mcTypePdf` → `mcTypeFiles` — ปุ่มเพิ่มการ์ดกดแล้วไม่มีอะไรเกิดขึ้น
 *  เพราะ getElementById คืน null แล้ว TypeError ตัดก่อนถึงบรรทัดเปิด modal)
 *
 * ค่านี้เปลี่ยนทุก deploy จึงทำให้ cache key เก่าใช้ไม่ได้เอง ไม่ต้องรอ TTL
 * และไม่ต้องพึ่งคนบอกให้ครูกด hard refresh
 *
 * บน Railway ใช้ commit sha ที่ platform ใส่มาให้ · dev ไม่มีตัวนั้นจึงถอยไปใช้
 * mtime ล่าสุดของไฟล์ใน src/ ซึ่งขยับทุกครั้งที่แก้หน้า
 */
const fs = require('fs');
const path = require('path');

let cached = null;

function buildId() {
  if (cached) return cached;

  const fromPlatform = process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.RAILWAY_DEPLOYMENT_ID
    || process.env.SOURCE_VERSION;
  if (fromPlatform) {
    cached = String(fromPlatform).slice(0, 12);
    return cached;
  }

  // อ่านครั้งเดียวตอนถูกเรียกครั้งแรก — dev แก้ไฟล์แล้ว nodemon restart อยู่แล้ว
  let newest = 0;
  const dir = path.join(__dirname, '../src');
  try {
    for (const name of fs.readdirSync(dir)) {
      const st = fs.statSync(path.join(dir, name));
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    }
  } catch { /* อ่านไม่ได้ก็ใช้เวลา boot ไปก่อน ดีกว่าไม่มีค่า */ }
  cached = 'dev' + Math.round(newest || Date.now()).toString(36);
  return cached;
}

module.exports = { buildId };
