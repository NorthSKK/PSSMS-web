'use strict';
/**
 * วันหมดอายุการใช้งาน — สำหรับแสดงในหน้าตั้งค่าระบบ
 *
 * ต่างจาก `getLicenseStatus` ที่ตอบว่า "ควรขึ้นแถบเตือนไหม" และเงียบสนิทตอนยัง
 * ไม่ใกล้หมด · อันนี้ตอบเสมอว่าวันหมดอายุคือวันไหน เพราะผู้ดูแลโรงเรียนควรเปิดดูได้
 * ทุกเมื่อว่าจ่ายถึงเมื่อไหร่ ไม่ใช่รู้ต่อเมื่อมีแถบสีเหลืองเด้งมา
 *
 * ⚠️ ADMIN_ONLY — ครูทั่วไปไม่ต้องเห็นเรื่องสัญญาบริการ
 */
const license = require('../lib/license');

module.exports = async function getLicenseInfo() {
  const { state, until, daysLeft } = await license.read();
  return {
    state,
    until: until || '',
    daysLeft: daysLeft == null ? null : daysLeft,
    graceDays: license.GRACE_DAYS,
  };
};
