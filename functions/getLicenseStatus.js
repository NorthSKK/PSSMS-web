'use strict';
/**
 * สถานะ licence สำหรับแถบแจ้งเตือนบนหัวเว็บ
 *
 * ตัดสินใจฝั่งเซิร์ฟเวอร์ว่าใครควรเห็นอะไร ไม่ส่งวันหมดอายุไปให้ครูทุกคน
 * ตอนที่ยังไม่ถึงกำหนด — ช่วงเหลือ 30 วันเป็นเรื่องระหว่างเรากับผู้บริหาร
 * ไม่ใช่เรื่องที่ครูต้องมากังวลกลางคาบ
 */
const license = require('../lib/license');
const { isAdmin } = require('../lib/permissions');

module.exports = async function getLicenseStatus(_args, user) {
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
