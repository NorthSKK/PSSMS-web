'use strict';
/**
 * ที่เก็บไฟล์สื่อการสอน — ดิสก์ของ Railway Volume
 *
 * เคยทำเป็น Google Drive มาก่อน แต่ต้องผ่าน OAuth consent screen แบบ production
 * ซึ่งบังคับให้ยืนยันความเป็นเจ้าของโดเมน — โฮสต์ที่ใช้อยู่คือ *.up.railway.app
 * ซึ่งเป็นของ Railway ไม่ใช่ของโรงเรียน จึงเพิ่มเป็น Authorized domain ไม่ได้
 * (ปล่อยไว้โหมด Testing ก็ไม่ได้ เพราะ refresh token หมดอายุใน 7 วัน)
 *
 * ผลพลอยได้ที่ดีกว่าเดิม: ไฟล์ไม่ได้เปิดเป็นสาธารณะเหมือนลิงก์ Drive แล้ว
 * เสิร์ฟผ่าน routes/media.js ที่ตรวจสิทธิ์ก่อนทุกครั้ง (ดู getMediaFileTicket)
 *
 * ⚠️ filesystem ของ Railway เป็น ephemeral — ไฟล์หายทุกครั้งที่ deploy
 *    ถ้าไม่ได้ mount Volume ไว้ ต้องสร้าง Volume ในหน้า Railway แล้วชี้
 *    MEDIA_STORAGE_DIR มาที่ mount path (ดู WEB_DEV.md)
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// dev ใช้โฟลเดอร์ในโปรเจกต์ (gitignored) — production ต้องชี้ไปที่ mount path ของ Volume
const ROOT = process.env.MEDIA_STORAGE_DIR || path.join(__dirname, '../storage/media');
const TRASH = path.join(ROOT, 'trash');
const TRASH_DAYS = 30;

function isConfigured() {
  // ไม่มีอะไรต้องตั้งค่า — เขียนดิสก์ได้ก็พอ ตรวจจริงตอน ensureReady()
  return true;
}

async function ensureReady() {
  await fsp.mkdir(TRASH, { recursive: true });
}

// key เป็นชื่อไฟล์บนดิสก์ สุ่มล้วน ไม่เอาชื่อที่ครูตั้งมาประกอบ
// (กัน path traversal และชื่อไฟล์ภาษาไทยที่ทำ encoding เพี้ยนข้ามระบบ)
function newKey() {
  return crypto.randomBytes(16).toString('hex') + '.pdf';
}

// key มาจาก DB ก็จริง แต่ยังกันไว้อีกชั้น — ค่าเดียวที่ยอมคือ hex 32 ตัว + .pdf
function safePath(key, dir) {
  if (!/^[0-9a-f]{32}\.pdf$/.test(String(key || ''))) throw new Error('ชื่อไฟล์ไม่ถูกต้อง');
  return path.join(dir || ROOT, key);
}

async function savePdf({ buffer, filename }) {
  await ensureReady();
  const key = newKey();
  await fsp.writeFile(safePath(key), buffer);
  return { key, name: filename, size: buffer.length };
}

function statSync(key) {
  try {
    return fs.statSync(safePath(key));
  } catch {
    return null;
  }
}

function readStream(key, opts) {
  return fs.createReadStream(safePath(key), opts);
}

/**
 * ลบการ์ด = ย้ายไฟล์เข้าโฟลเดอร์ trash พร้อมประทับเวลา กู้คืนได้ 30 วัน
 * เลียนแบบพฤติกรรมถังขยะของ Drive ที่ตกลงกันไว้ตอนออกแบบ
 */
async function trashFile(key) {
  if (!key) return;
  await ensureReady();
  const src = safePath(key);
  const dest = path.join(TRASH, `${Date.now()}__${key}`);
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code === 'ENOENT') return; // ไฟล์หายไปแล้ว ไม่ใช่เรื่องต้อง fail การลบการ์ด
    throw err;
  }
  purgeOldTrash().catch(() => {}); // กวาดของเก่าแบบ fire-and-forget ไม่ต้องมี cron
}

async function untrashFile(key) {
  if (!key) return;
  await ensureReady();
  if (statSync(key)) return; // อยู่ที่เดิมอยู่แล้ว
  const entries = await fsp.readdir(TRASH);
  const found = entries.find(f => f.endsWith(`__${key}`));
  if (!found) throw new Error('ไฟล์ถูกลบถาวรไปแล้ว (เกิน ' + TRASH_DAYS + ' วัน)');
  await fsp.rename(path.join(TRASH, found), safePath(key));
}

// ลบของในถังขยะที่เกินกำหนด — คืนพื้นที่โดยไม่ต้องมีใครมานั่งลบเอง
async function purgeOldTrash() {
  await ensureReady();
  const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const entries = await fsp.readdir(TRASH);
  let removed = 0;
  for (const f of entries) {
    const ts = parseInt(String(f).split('__')[0], 10);
    if (Number.isFinite(ts) && ts < cutoff) {
      await fsp.unlink(path.join(TRASH, f)).catch(() => {});
      removed++;
    }
  }
  return removed;
}

/**
 * สถานะให้หน้า Admin — ไม่ throw เพราะหน้าต้องแสดงว่ามีปัญหาได้ ไม่ใช่พังทั้งหน้า
 *
 * ตรวจว่า "เขียนได้จริง" ไม่ใช่แค่โฟลเดอร์มีอยู่ — บั๊กที่เจ็บที่สุดของที่เก็บไฟล์
 * คือรู้ว่าเขียนไม่ได้ตอนครูกดอัปโหลดแล้วเท่านั้น
 */
async function status() {
  try {
    await ensureReady();
    const probe = path.join(ROOT, '.write-probe');
    await fsp.writeFile(probe, 'ok');
    await fsp.unlink(probe);

    const [files, trash] = await Promise.all([fsp.readdir(ROOT), fsp.readdir(TRASH)]);
    let usage = 0;
    let count = 0;
    for (const f of files) {
      if (!f.endsWith('.pdf')) continue;
      const st = await fsp.stat(path.join(ROOT, f)).catch(() => null);
      if (st) { usage += st.size; count++; }
    }

    const disk = await fsp.statfs(ROOT).catch(() => null);
    return {
      connected: true,
      dir: ROOT,
      // ephemeral = ยังไม่ได้ mount Volume ไฟล์จะหายตอน deploy รอบหน้า
      ephemeral: !process.env.MEDIA_STORAGE_DIR,
      files: count,
      trashed: trash.length,
      usage,
      limit: disk ? disk.blocks * disk.bsize : 0,
      free: disk ? disk.bavail * disk.bsize : 0,
    };
  } catch (err) {
    return { connected: false, dir: ROOT, reason: 'เขียนที่เก็บไฟล์ไม่ได้: ' + err.message };
  }
}

module.exports = {
  ROOT, TRASH_DAYS,
  isConfigured, ensureReady, savePdf, statSync, readStream,
  trashFile, untrashFile, purgeOldTrash, status, safePath,
};
