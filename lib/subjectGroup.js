'use strict';
/**
 * แปลง subject_code → ชื่อกลุ่มสาระ ตามอักษรตัวแรกของรหัสวิชา
 *
 * ⚠️ ใช้สำหรับ "ป้ายบอกกลุ่ม" บนหน้าจอเท่านั้น — ห้ามใช้ตัดสินว่าครูถนัดวิชาไหน
 * `users.department` บน production เก็บ "วิชาเอก" (ฟิสิกส์ / ดนตรีศึกษา / นาฏศิลป์ /
 * อุตสาหกรรม) ไม่ใช่ชื่อกลุ่มสาระ 8 กลุ่ม เทียบตรง ๆ แล้วไม่ตรง 9 ใน 12 คน
 * ความถนัดจริงดูจาก timetable ว่าครูสอน prefix ไหนกี่คาบ (functions/substituteAuto.js)
 *
 * สำเนาฝั่ง client อยู่ที่ src/Scripts_Score.html (ฟังก์ชันพิมพ์ ปพ.5) — ไฟล์นั้นถูก
 * เสิร์ฟดิบโดย routes/assets.js ไม่มี module system จึงแชร์โค้ดกันไม่ได้ **แก้คู่กันเสมอ**
 */

const SUBJECT_GROUP_BY_PREFIX = {
  'ท': 'ภาษาไทย',
  'ค': 'คณิตศาสตร์',
  'ว': 'วิทยาศาสตร์และเทคโนโลยี',
  'ส': 'สังคมศึกษา ศาสนา และวัฒนธรรม',
  'พ': 'สุขศึกษาและพลศึกษา',
  'ศ': 'ศิลปะ',
  'ง': 'การงานอาชีพ',
  'อ': 'ภาษาต่างประเทศ',
  'ก': 'กิจกรรมพัฒนาผู้เรียน',
  'I': 'กิจกรรมพัฒนาผู้เรียน',
  'i': 'กิจกรรมพัฒนาผู้เรียน',
};

// รหัสที่ไม่ใช่รายวิชาตามกลุ่มสาระ — HR (โฮมรูม), '-' (แนะแนว/วิถีพุทธ ที่
// setAllHomeroomTeachers สร้าง), CLUB_* (ชุมนุม) ทั้งหมดคืน '' ไม่ใช่เดาเป็นกลุ่มใดกลุ่มหนึ่ง
function subjectPrefixOf(subjectCode) {
  const code = String(subjectCode || '').trim();
  if (!code) return '';
  const upper = code.toUpperCase();
  if (upper === 'HR' || upper === '-' || upper.startsWith('CLUB')) return '';
  return code.charAt(0);
}

function subjectGroupOf(subjectCode) {
  return SUBJECT_GROUP_BY_PREFIX[subjectPrefixOf(subjectCode)] || '';
}

// คาบโฮมรูมไม่เข้าระบบสอนแทน — ครูที่ปรึกษาอีกคนของห้องดูแลอยู่แล้วตามธรรมชาติ
// ไม่ต้องจัดคนนอกมาแทน (ดูหัวข้อ "จัดตารางสอนแทน" ใน CLAUDE.md)
function isHomeroomSubject(subjectCode) {
  return String(subjectCode || '').trim().toUpperCase() === 'HR';
}

module.exports = { SUBJECT_GROUP_BY_PREFIX, subjectPrefixOf, subjectGroupOf, isHomeroomSubject };
