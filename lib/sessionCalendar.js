'use strict';
/**
 * ปฏิทินคาบสอน — "คาบไหนบ้างที่ควรจะสอน" คำนวณจาก timetable + ช่วงเปิด-ปิดเทอม + วันหยุด
 *
 * แยกออกมาจาก functions/attendance.js เพราะมีผู้ใช้สองราย: หน้าเช็คชื่อย้อนหลัง
 * (ทีละวิชา×ห้อง) และกระดานติดตามงานครู (ทั้งโรงเรียนทีเดียว)
 *
 * ⚠️ ไฟล์นี้ **ไม่แตะ DB เลย** โดยตั้งใจ — ตัวเรียกเป็นคนโหลดข้อมูลเอง
 * `_expectedSessions` โหลดต่อวิชา×ห้อง ส่วนกระดานโหลดครั้งเดียวแล้ว expand ทุกคู่
 * ถ้าเอาการ query กลับมาใส่ในนี้ กระดานจะยิง query หลักร้อยครั้งต่อการเปิดหนึ่งครั้ง
 */

const THAI_DOW = { 'อาทิตย์': 0, 'จันทร์': 1, 'อังคาร': 2, 'พุธ': 3, 'พฤหัสบดี': 4, 'ศุกร์': 5, 'เสาร์': 6 };

// timetable rows → slots ที่ expandSlots ใช้ได้ (แถวที่ชื่อวันอ่านไม่ออกถูกทิ้ง)
function slotsFromRows(rows) {
  return rows
    .map(r => ({ dow: THAI_DOW[String(r.day || '').trim()], period: String(r.period) }))
    .filter(s => s.dow !== undefined);
}

// ทุก (date, period) ที่ slots เหล่านี้ตกในช่วง start..end โดยข้ามวันหยุด
// start/end เป็น Date (UTC midnight), holidays เป็น Set ของ 'YYYY-MM-DD'
function expandSlots(slots, start, end, holidays) {
  if (!slots.length || isNaN(start) || isNaN(end) || start > end) return [];
  const out = [];
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    const dateStr = d.toISOString().slice(0, 10);
    if (holidays.has(dateStr)) continue;
    for (const s of slots) {
      if (s.dow === dow) out.push({ date: dateStr, period: s.period });
    }
  }
  return out;
}

module.exports = { THAI_DOW, slotsFromRows, expandSlots };
