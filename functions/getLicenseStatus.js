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
  if (process.env.PSSMS_SERVICE_READONLY === '1') {
    return { show: true, state: 'locked',
      text: 'ระบบอยู่ระหว่างเก็บสำรองเพื่อปิดบริการ อ่าน พิมพ์ และส่งออกข้อมูลได้ แต่บันทึกข้อมูลใหม่ไม่ได้ ติดต่อผู้ดูแลหากต้องการกลับมาใช้งาน' };
  }
  // เดโมมาก่อน — ผู้เข้ามาลองต้องรู้ตั้งแต่แรกว่าข้อมูลที่กรอกจะหายตอนตีสาม
  if (await _isDemo()) {
    return {
      show: true, state: 'demo',
      text: 'นี่คือระบบทดลอง กรอกอะไรก็ได้ตามสบาย ข้อมูลทั้งหมดจะถูกล้างกลับเป็นค่าตั้งต้นทุกคืน เวลา 03:00 น.',
    };
  }

  const { state, until, daysLeft } = await license.read();
  const { closeAfter } = require('../lib/serviceArchiveState').archiveState();

  // A delivered closure notice is for everyone, including a trial school that
  // is still active. Ordinary renewal reminders retain their Admin-only rule.
  if (closeAfter && (state === 'none' || state === 'active' || state === 'warn' && !isAdmin(user))) {
    return { show: true, state: 'warn', until, daysLeft,
      text: `กำหนดปิดบริการเร็วที่สุด ${closeAfter} กรุณาพิมพ์หรือส่งออกข้อมูลก่อนวันดังกล่าว ` +
        'หลังปิดบริการผู้ให้บริการจะเก็บชุดสำรองระยะยาว ติดต่อผู้ดูแลหากต้องการใช้งานต่อ' };
  }

  // ยังไม่ถึงกำหนด: เห็นเฉพาะ Admin และเห็นก็ต่อเมื่อเหลือน้อยกว่า 30 วัน
  if (state === 'none' || state === 'active') return { show: false, state };
  if (state === 'warn' && !isAdmin(user)) return { show: false, state: 'active' };

  let text = {
    warn:   `ระบบจะหมดอายุการใช้งานวันที่ ${until} (อีก ${daysLeft} วัน) ติดต่อผู้ดูแลเพื่อต่ออายุ`,
    grace:  `หมดอายุการใช้งานแล้วเมื่อ ${until} ยังใช้งานได้อีก ${license.GRACE_DAYS + daysLeft} วัน ` +
            'หลังจากนั้นจะบันทึกข้อมูลใหม่ไม่ได้',
    locked: `หมดอายุการใช้งานเมื่อ ${until} ขณะนี้เป็นโหมดอ่านอย่างเดียว ` +
            'พิมพ์ ปพ.5 และ export ยังใช้ได้ตามปกติ',
  }[state];

  if (closeAfter && ['warn', 'grace', 'locked'].includes(state)) {
    text += ` กำหนดปิดบริการเร็วที่สุด ${closeAfter} กรุณาพิมพ์หรือส่งออกข้อมูลก่อนวันดังกล่าว ` +
      'หลังปิดบริการผู้ให้บริการจะเก็บชุดสำรองระยะยาว ติดต่อผู้ดูแลหากต้องการใช้งานต่อ';
  }

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
