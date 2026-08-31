'use strict';
/**
 * สถานะ licence สำหรับแถบแจ้งเตือนบนหัวเว็บ
 *
 * ตัดสินใจฝั่งเซิร์ฟเวอร์ว่าใครควรเห็นอะไร ไม่ส่งวันหมดอายุไปให้ครูทุกคน
 * ตอนที่ยังไม่ถึงกำหนด — ช่วงเหลือ 30 วันเป็นเรื่องระหว่างเรากับผู้บริหาร
 * ไม่ใช่เรื่องที่ครูต้องมากังวลกลางคาบ
 */
const license = require('../lib/license');
const cache = require('../lib/cache');
const { isDemoDatabase } = require('../lib/instance');
const { isAdmin } = require('../lib/permissions');

module.exports = async function getLicenseStatus(_args, user) {
  // เดโมมาก่อน — ผู้เข้ามาลองต้องรู้ตั้งแต่แรกว่าข้อมูลที่กรอกจะหายตอนตีสาม
  if (await _isDemo()) {
    return {
      show: true, state: 'demo',
      text: 'นี่คือระบบทดลอง กรอกอะไรก็ได้ตามสบาย ข้อมูลทั้งหมดจะถูกล้างกลับเป็นค่าตั้งต้นทุกคืน เวลา 03:00 น.',
    };
  }

  const { state, until, daysLeft } = await license.read();

  // ยังไม่ถึงกำหนด: เห็นเฉพาะ Admin และเห็นก็ต่อเมื่อเหลือน้อยกว่า 30 วัน
  if (state === 'none' || state === 'active') return { show: false, state };
  if (state === 'warn' && !isAdmin(user)) return { show: false, state: 'active' };

  const text = {
    warn:   `ระบบจะหมดอายุการใช้งานวันที่ ${until} (อีก ${daysLeft} วัน) ติดต่อผู้ดูแลเพื่อต่ออายุ`,
    grace:  `หมดอายุการใช้งานแล้วเมื่อ ${until} ยังใช้งานได้อีก ${license.GRACE_DAYS + daysLeft} วัน ` +
            `หลังจากนั้นจะบันทึกข้อมูลใหม่ไม่ได้`,
    locked: `หมดอายุการใช้งานเมื่อ ${until} ขณะนี้เป็นโหมดอ่านอย่างเดียว ` +
            `พิมพ์ ปพ.5 และ export ยังใช้ได้ตามปกติ`,
  }[state];

  return { show: true, state, until, daysLeft, text };
};

// เช็คทุกครั้งที่เรนเดอร์หน้าแรก — แคชไว้ ไม่ต้องยิง DB ซ้ำ ค่านี้ไม่เปลี่ยนระหว่างรัน
async function _isDemo() {
  const hit = cache.get('is_demo');
  if (hit !== null) return hit === 'yes';
  let demo = false;
  try { demo = await isDemoDatabase(); } catch (_) { demo = false; }
  cache.set('is_demo', demo ? 'yes' : 'no', 300);
  return demo;
}
