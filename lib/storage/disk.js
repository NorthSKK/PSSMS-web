'use strict';
/**
 * driver `disk` — เขียนไฟล์ลงดิสก์ที่ MEDIA_STORAGE_DIR
 *
 * ใช้ตอน dev และรันเทสต์เท่านั้น production ใช้ driver `s3`
 * (Railway ไม่มีดิสก์ถาวร ไฟล์หายทุก deploy — ดู lib/storage/s3.js)
 *
 * ไม่ตั้ง MEDIA_STORAGE_DIR = ปิดฟีเจอร์อัปโหลด ไม่ใช่แค่เปลี่ยนโฟลเดอร์ปลายทาง
 * เพราะเขียนลง filesystem ชั่วคราวแล้วบอกครูว่าสำเร็จคือหลอกกัน
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const types = require('./types');

const name = 'disk';

// dev ไม่ได้ตั้ง env → ใช้โฟลเดอร์ในโปรเจกต์ (gitignored) แต่ isConfigured() ยังเป็น false
const ROOT = process.env.MEDIA_STORAGE_DIR || path.join(__dirname, '../../storage/media');

function isConfigured() {
  return !!process.env.MEDIA_STORAGE_DIR;
}

async function ensureReady() {
  await fsp.mkdir(ROOT, { recursive: true });
}

// key สุ่มล้วน ไม่เอาชื่อที่ครูตั้งมาประกอบ — กัน path traversal และชื่อไฟล์ไทยที่ทำ
// encoding เพี้ยนข้ามระบบ (ชื่อจริงเก็บในคอลัมน์ file_name ไว้แสดงผลอยู่แล้ว)
// นามสกุลมาจากผลตรวจ magic bytes ไม่ใช่จากชื่อไฟล์ที่ client ส่ง
function newKey(ext) {
  return crypto.randomBytes(16).toString('hex') + '.' + ext;
}

// key มาจาก DB ก็จริง แต่ยังกันอีกชั้น — ยอมเฉพาะ hex 32 ตัว + นามสกุลใน allowlist
function safePath(key) {
  if (!types.isValidKey(key)) throw new Error('ชื่อไฟล์ไม่ถูกต้อง');
  return path.join(ROOT, key);
}

async function put({ buffer, ext }) {
  if (!types.byExt(ext)) throw new Error('ชนิดไฟล์ไม่ถูกต้อง');
  await ensureReady();
  const key = newKey(ext);
  await fsp.writeFile(safePath(key), buffer);
  return { key, size: buffer.length };
}

async function remove(key) {
  if (!key) return;
  await fsp.unlink(safePath(key)).catch(err => {
    if (err.code !== 'ENOENT') throw err; // ไฟล์หายไปแล้วถือว่าสำเร็จ
  });
}

/**
 * disk ไม่มี presigned URL — ออกตั๋วของเราเองแล้วให้ routes/media.js เสิร์ฟไฟล์
 * (route นั้น mount เฉพาะตอน driver เป็น disk)
 *
 * ต้องมีตั๋วเพราะ window.open แนบ Authorization header ไม่ได้ — JWT อยู่ใน
 * localStorage ไม่ใช่ cookie · สิทธิ์ถูกตรวจตอน "ออก" URL ไม่ใช่ตอนเสิร์ฟไฟล์
 * ซึ่งเป็นกติกาเดียวกับ driver s3 ที่ใช้ presigned URL
 */
async function getFileUrl({ kind, id, user }) {
  const ticket = jwt.sign(
    { kind: String(kind), id: Number(id), uid: String(user?.id || '') },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
  return `/api/media/file/${kind}/${id}?t=${encodeURIComponent(ticket)}`;
}

/** ตรวจว่า "เขียนได้จริง" ไม่ใช่แค่โฟลเดอร์มีอยู่ — รู้ตอนครูกดอัปโหลดแล้วสายไป */
async function check() {
  if (!isConfigured()) {
    return { ok: false, detail: 'ยังไม่ได้ตั้ง MEDIA_STORAGE_DIR' };
  }
  try {
    await ensureReady();
    const probe = path.join(ROOT, '.write-probe');
    await fsp.writeFile(probe, 'ok');
    await fsp.unlink(probe);
    return { ok: true, detail: ROOT };
  } catch (err) {
    return { ok: false, detail: 'เขียนที่เก็บไฟล์ไม่ได้: ' + err.message };
  }
}

// เฉพาะ routes/media.js ตอนเสิร์ฟไฟล์เอง
function statSync(key) {
  try { return fs.statSync(safePath(key)); } catch { return null; }
}
function readStream(key, opts) {
  return fs.createReadStream(safePath(key), opts);
}

module.exports = {
  name, ROOT,
  isConfigured, put, remove, getFileUrl, check,
  ensureReady, safePath, statSync, readStream,
};
