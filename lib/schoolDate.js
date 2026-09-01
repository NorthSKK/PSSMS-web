'use strict';
/**
 * "วันนี้" ตามเวลาโรงเรียน (Asia/Bangkok)
 *
 * ⚠️ ห้ามใช้ `new Date().toISOString().slice(0,10)` และห้ามใช้ `getFullYear()/getDay()`
 * ของ Date ตรง ๆ เพื่อหาว่าวันนี้คือวันอะไร
 *
 * - `toISOString()` ให้วันแบบ UTC — เวลาไทย 00:00–07:00 ยังเป็นเมื่อวานใน UTC
 * - `getFullYear()/getDay()` ให้วันตาม TZ ของ **process** ซึ่งบน Railway คือ UTC
 *   (ไม่ได้ตั้ง TZ ไว้ที่ไหนเลย) เครื่อง dev เป็นเวลาไทยจึงผ่านเสมอ แล้วไปพลาดบน production
 *
 * ทั้งสองแบบทำให้ครูที่เปิดระบบเช้ามืดเห็นตารางของเมื่อวาน
 */

// en-CA ให้รูป YYYY-MM-DD พอดี
const _FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Date → 'YYYY-MM-DD' ตามเวลาไทย */
function schoolDateStr(d = new Date()) {
  return _FMT.format(d);
}

/** วันนี้ตามเวลาไทย เป็น 'YYYY-MM-DD' */
function schoolToday() {
  return schoolDateStr(new Date());
}

/** 'YYYY-MM-DD' → 0=อาทิตย์ ... 6=เสาร์ (อ่านจากสตริง ไม่พึ่ง TZ ของ process) */
function schoolDayIndex(dateStr) {
  return new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`).getUTCDay();
}

module.exports = { schoolDateStr, schoolToday, schoolDayIndex };
