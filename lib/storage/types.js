'use strict';
/**
 * ชนิดไฟล์ที่ระบบรับ — allowlist ชุดเดียวใช้ทั้งตอนตรวจขาเข้าและตอนเสิร์ฟ
 *
 * ⚠️ **ตัดสินชนิดจาก magic bytes เท่านั้น ไม่เชื่อ MIME หรือนามสกุลที่ client ส่งมา**
 *    นามสกุลที่เก็บลง key ก็มาจากผลตรวจนี้ ไม่ใช่จากชื่อไฟล์เดิม
 *
 * docx เป็น ZIP (PK\x03\x04) จึงยืนยันได้แค่ว่า "เป็น zip" ไม่ใช่ว่าเป็นเอกสาร Word จริง
 * จึงรับเฉพาะ .docx (เก็บ macro ไม่ได้ตามสเปก) ไม่รับ .doc (OLE2 เก็บ macro ได้)
 * และ .docm (macro-enabled โดยนิยาม) — และเสิร์ฟเป็น attachment ไม่ให้เบราว์เซอร์เรนเดอร์
 */

const TYPES = [
  {
    ext: 'pdf',
    mime: 'application/pdf',
    magic: Buffer.from('%PDF-', 'latin1'),
    disposition: 'inline',
    label: 'PDF',
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    magic: Buffer.from([0xff, 0xd8, 0xff]),
    disposition: 'inline',
    label: 'JPEG',
  },
  {
    ext: 'png',
    mime: 'image/png',
    magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    disposition: 'inline',
    label: 'PNG',
  },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]), // ZIP — docx คือ zip
    // บังคับดาวน์โหลด ไม่ให้เบราว์เซอร์พยายามเปิดเอง
    disposition: 'attachment',
    label: 'Word (.docx)',
  },
];

const EXTENSIONS = TYPES.map(t => t.ext);

/** นามสกุลที่ยอมให้อยู่ใน key — ใช้ประกอบ regex ของทั้งสอง driver */
const EXT_PATTERN = EXTENSIONS.join('|');

const KEY_RE = new RegExp(`^[0-9a-f]{32}\\.(${EXT_PATTERN})$`);

function isValidKey(key) {
  return KEY_RE.test(String(key || ''));
}

function extOf(key) {
  const m = KEY_RE.exec(String(key || ''));
  return m ? m[1] : '';
}

function byExt(ext) {
  return TYPES.find(t => t.ext === String(ext || '').toLowerCase()) || null;
}

/**
 * ตรวจชนิดจริงจากหัวไฟล์ คืน type หรือ null ถ้าไม่อยู่ใน allowlist
 * `allowed` จำกัดให้แคบลงได้ต่อจุดใช้งาน (สื่อการสอนรับแค่ pdf)
 */
function detect(buffer, allowed) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const list = allowed && allowed.length
    ? TYPES.filter(t => allowed.includes(t.ext))
    : TYPES;
  return list.find(t =>
    buffer.length >= t.magic.length && buffer.subarray(0, t.magic.length).equals(t.magic)
  ) || null;
}

/** ป้ายบอกชนิดที่ผู้ใช้อ่านรู้เรื่อง สำหรับข้อความ error */
function labels(allowed) {
  const list = allowed && allowed.length ? TYPES.filter(t => allowed.includes(t.ext)) : TYPES;
  return list.map(t => t.label).join(' / ');
}

module.exports = { TYPES, EXTENSIONS, KEY_RE, isValidKey, extOf, byExt, detect, labels };
