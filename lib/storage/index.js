'use strict';
/**
 * ที่เก็บไฟล์สื่อการสอน — เลือก driver ด้วย env `STORAGE_DRIVER`
 *
 *   disk (default)  เขียนลงดิสก์ที่ MEDIA_STORAGE_DIR — ใช้ตอน dev และรันเทสต์
 *   s3              object storage ที่พูด S3 API (Cloudflare R2 เป็นค่าเริ่มต้นที่ตั้งใจ)
 *
 * ทำไมต้องมี 2 driver: dev ต้องแก้ระบบนี้ได้โดยไม่ต้องมี token ไม่ต้องมีเน็ต
 * และเทสต์ทั้งชุดยืนบน disk อยู่แล้ว · production ใช้ s3 เพราะ Railway ไม่มีดิสก์ถาวร
 *
 * ทำไมเป็น S3-compatible ไม่ผูกกับ R2: ย้ายไป Backblaze B2 / MinIO (ถ้าโรงเรียนขอให้
 * ข้อมูลอยู่บนเครื่องตัวเอง) / S3 จริง ทำได้ด้วยการแก้ env ไม่ต้องแก้โค้ด
 *
 * ── interface ที่ทั้งสอง driver ต้องมี ────────────────────────────────
 *   name                        ชื่อ driver ไว้แสดงสถานะ
 *   isConfigured()              ตั้งค่าครบพอจะรับไฟล์ไหม (ไม่ครบ = ปิดฟีเจอร์อัปโหลด)
 *   put({buffer, filename})     → { key, size }
 *   remove(key)                 ลบถาวร (ไม่มีถังขยะระดับ storage — ดูหมายเหตุข้างล่าง)
 *   getFileUrl({cardId, key, filename, user})  → URL ที่เบราว์เซอร์เปิดได้ อายุสั้น
 *   check()                     → { ok, detail } ตรวจว่าที่เก็บใช้งานได้จริง
 *
 * ── ถังขยะ 30 วันอยู่ที่ DB ไม่ใช่ที่ storage ────────────────────────
 * `media_cards.deleted_at` เป็นแหล่งความจริงเพียงที่เดียว ลบการ์ด = ไม่แตะไฟล์เลย
 * กู้คืน = ล้าง deleted_at (ไม่แตะไฟล์อีกเหมือนกัน จึงไม่มีทางกู้แล้วได้การ์ดที่เปิดไม่ได้)
 * พ้น 30 วัน = สคริปต์กวาดลบ object แล้วค่อยลบแถว (ดู functions/mediaCards.js purgeExpiredCards)
 */
const DRIVERS = {
  disk: () => require('./disk'),
  s3: () => require('./s3'),
};

function driverName() {
  const name = String(process.env.STORAGE_DRIVER || 'disk').trim().toLowerCase();
  return DRIVERS[name] ? name : 'disk';
}

// ไม่ cache ไว้ — เปลี่ยน env แล้วต้อง restart อยู่แล้ว และการ cache ทำให้เทสต์
// ที่สลับ driver ต้องมาล้าง require cache เอง
function driver() {
  return DRIVERS[driverName()]();
}

module.exports = {
  driverName,
  isConfigured: () => driver().isConfigured(),
  put: (args) => driver().put(args),
  remove: (key) => driver().remove(key),
  getFileUrl: (args) => driver().getFileUrl(args),
  check: () => driver().check(),
  // เฉพาะ disk — routes/media.js ใช้ตอนเสิร์ฟไฟล์เอง (production ไม่ mount route นั้น)
  get disk() { return require('./disk'); },
};
