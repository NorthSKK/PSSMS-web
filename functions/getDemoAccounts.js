'use strict';
/**
 * บัญชีให้ผู้เยี่ยมชมเลือกบทบาทบนหน้าล็อกอิน — เฉพาะเครื่องเดโมสาธารณะ
 *
 * ⚠️ ปลายทางนี้เรียกได้โดยไม่ต้องล็อกอิน (PUBLIC_FNS) จึงห้ามอ่าน users.password
 *    ออกไปเด็ดขาด ถ้าวันหนึ่งเครื่องของโรงเรียนจริงถูกทำเครื่องหมายเป็นเดโมโดยพลาด
 *    สิ่งที่หลุดต้องเป็นค่าคงที่ในไฟล์นี้ ไม่ใช่รหัสผ่านจริงของครูทั้งโรงเรียน
 *    (auth ของระบบนี้เทียบรหัสผ่านเป็น plaintext ใน SQL — ดู CLAUDE.md)
 *
 * บนเครื่องโรงเรียนจริงคืนอาร์เรย์ว่างเสมอ หน้าล็อกอินจึงไม่มีอะไรเปลี่ยน
 */
const { query } = require('../lib/db');
const { isDemoDatabase } = require('../lib/instance');

// db/seed-demo.js ตั้งรหัสผ่านทุกบัญชีเป็นค่านี้ และหน้าขายก็ประกาศไว้แล้ว
const DEMO_PASSWORD = '1234';

// เรียงตามลำดับที่อยากให้คนกดลอง ไม่ใช่ตามตัวอักษร — ครูผู้สอนคือคนที่เราขายให้
const ROLES = [
  { username: 'teacher2', label: 'ครูผู้สอน',   hint: 'เช็คชื่อ กรอกคะแนน พิมพ์ ปพ.5' },
  { username: 'admin',    label: 'ผู้ดูแลระบบ', hint: 'ตารางสอน จัดสอนแทน ตั้งค่าทั้งระบบ' },
  { username: 'director', label: 'ผู้บริหาร',   hint: 'ภาพรวมทั้งโรงเรียน อนุมัติใบลา' },
  // รหัสนักเรียนถูกสร้างใหม่ทุกครั้งที่ seed จึงหาเอาจาก role ไม่ผูกกับเลขใดเลขหนึ่ง
  { role: 'Student',      label: 'นักเรียน',    hint: 'ดูคะแนน เวลาเรียน และสื่อของตัวเอง' },
];

module.exports = async function getDemoAccounts() {
  if (!(await isDemoDatabase())) return [];

  // เอาเฉพาะบัญชีที่มีอยู่จริง — seed เปลี่ยนแล้วลิสต์นี้จะสั้นลงเอง
  // ไม่ใช่โชว์ปุ่มที่กดแล้วล็อกอินไม่ผ่าน
  const named = ROLES.filter(r => r.username).map(r => r.username);
  const { rows } = await query(
    `SELECT username, full_name FROM users WHERE username = ANY($1)`, [named]
  );
  const found = new Map(rows.map(r => [r.username, r.full_name]));

  const out = [];
  for (const r of ROLES) {
    let username = r.username, name;
    if (username) {
      if (!found.has(username)) continue;
      name = found.get(username);
    } else {
      const { rows: byRole } = await query(
        `SELECT username, full_name FROM users WHERE role=$1 ORDER BY username LIMIT 1`, [r.role]
      );
      if (!byRole.length) continue;
      username = byRole[0].username;
      name = byRole[0].full_name;
    }
    out.push({ username, password: DEMO_PASSWORD, label: r.label, hint: r.hint, name: name || username });
  }
  return out;
};
