'use strict';
/**
 * อัปโหลดไฟล์ — REST endpoints ชุดเดียวของ repo นี้
 *
 * ที่เหลือทั้งระบบคุยผ่าน shim `google.script.run` → POST /api/gas/<fnName> ซึ่งรับแต่ JSON
 * ไฟล์ binary ไม่เข้ากับทางนั้น: จะส่งต้องแปลงเป็น base64 (บวม 33%) และต้องดัน
 * `express.json` limit ที่ server.js เป็น global ขึ้นเป็นหลายสิบ MB ซึ่งเปิดช่อง DoS
 * ให้ทุก endpoint ที่เหลือ
 *
 * เส้นแบ่งจึงเป็น: **binary ไป REST, ที่เหลือไป /api/gas**
 *
 *   POST /api/media/upload/:cardId  แนบไฟล์เข้าการ์ดสื่อการสอน — PDF/JPEG/PNG 100MB ต่อไฟล์
 *   POST /api/media/sarabun/:id     ไฟล์แนบงานสารบรรณ — PDF/JPEG/PNG/DOCX 10MB
 *   GET  /api/media/file/:kind/:id  เสิร์ฟไฟล์เอง — **เฉพาะ driver disk (dev)**
 *
 * การ์ดสื่อรับ **ทีละไฟล์** ถึงจะอัปหลายใบพร้อมกันในหน้าเดียว — client ยิงเรียงกันเอง
 * พักไฟล์ลงดิสก์ชั่วคราว แล้ว stream ไปที่เก็บ ไม่ถือทั้งไฟล์ใน RAM
 * ล้มใบเดียวไม่ล้มทั้งชุด และไฟล์พักถูกลบหลังบันทึกหรือเมื่อเกิดข้อผิดพลาด
 */
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const { teacherOrAdmin } = require('../lib/permissions');
const cache = require('../lib/cache');
const { query } = require('../lib/db');
const mediaCards = require('../functions/mediaCards');
const sarabun = require('../functions/sarabun');
const projects = require('../functions/projectDocuments');
const storage = require('../lib/storage');
const types = require('../lib/storage/types');

/**
 * โควตาต่อคนต่อชั่วโมง — **นับเป็นไบต์ ไม่ใช่จำนวนครั้ง**
 *
 * เจตนาเดิมคือกันพื้นที่เก็บที่ใช้ร่วมกันทั้งโรงเรียน ไม่ใช่กันจำนวนครั้ง ·
 * ตอนที่การ์ดหนึ่งใบ = ไฟล์หนึ่งใบ นับครั้งก็ได้ผลเท่ากัน แต่พอการ์ดใบเดียวมีได้ 30 ไฟล์
 * เพดาน 20 ครั้ง/ชม. จะชนตั้งแต่ใบที่ 21 = อัปหนังสือทั้งเล่มไม่ได้เลย
 */
// ⚠️ ผูกกับ MAX_UPLOAD_MB — เป็นไบต์ ไม่ใช่จำนวนครั้ง เพดานไฟล์โตแล้วจำนวนไฟล์
//    ที่อัปได้ต่อชั่วโมงจะลดตามเงียบ ๆ · 2GB ที่ไฟล์ละ 100MB = ~20 ไฟล์/ชม.
//    เท่ากับตอนไฟล์ละ 25MB ใน 500MB ซึ่งเป็นอัตราที่ใช้มาแล้วโดยไม่มีใครชน
const RATE_LIMIT = { maxBytes: 2 * 1024 * 1024 * 1024, windowSec: 3600 };

function budgetKey(req) {
  return `media_upload_${String(req.user?.id || '').toLowerCase()}`;
}

// เช็คก่อนรับ: ใช้เกินไปแล้วหรือยัง · ไฟล์ใบที่ทำให้เกินพอดีปล่อยผ่าน แล้วใบถัดไปค่อยโดนกั้น
// (ต้องอ่านไฟล์จบก่อนถึงจะรู้ขนาดจริง — กันแบบเป๊ะต้องเชื่อ Content-Length ที่ client ส่งมา)
function underBudget(req, res, next) {
  if ((cache.get(budgetKey(req)) || 0) >= RATE_LIMIT.maxBytes) {
    const mb = Math.round(RATE_LIMIT.maxBytes / (1024 * 1024));
    return res.status(429).json({
      __error: `อัปโหลดเกิน ${mb} MB ต่อชั่วโมงแล้ว รอสักครู่แล้วลองใหม่`,
    });
  }
  next();
}

function chargeBudget(req, bytes) {
  const key = budgetKey(req);
  cache.set(key, (cache.get(key) || 0) + Number(bytes || 0), RATE_LIMIT.windowSec);
}

/**
 * busboy (ใต้ multer) ถอด filename ใน multipart header เป็น latin1
 * ชื่อไฟล์ภาษาไทยจึงกลายเป็น mojibake ตั้งแต่ตอนรับเข้ามา แล้วไปโผล่บนการ์ดของครู
 * แปลงกลับเป็น utf8 เฉพาะตอนที่แปลงแล้ว round-trip กลับได้ตรง (ชื่อ ASCII จะไม่ถูกแตะ)
 */
function decodeFilename(name) {
  const raw = String(name || '');
  try {
    const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
    if (utf8.includes('�')) return raw;
    return Buffer.from(utf8, 'utf8').toString('latin1') === raw ? utf8 : raw;
  } catch {
    return raw;
  }
}

/**
 * ที่พักไฟล์ระหว่างอัป — **ไม่ใช่ที่เก็บถาวร** ลบทิ้งทุกเส้นทางที่ออกจาก request
 * อยู่บนดิสก์ชั่วคราวของ container ซึ่งหายทุก deploy อยู่แล้ว จึงไม่มีอะไรตกค้างข้ามรอบ
 */
const TMP_DIR = path.join(os.tmpdir(), 'pssms-upload');

/** ลบไฟล์พักให้ครบทุกทางออก — ลืมที่เดียวคือดิสก์เต็มเงียบ ๆ ในอีกหลายเดือน */
async function dropTemp(file) {
  if (file && file.path) await fsp.unlink(file.path).catch(() => {});
}

function guardTeacher(req, res, next) {
  try {
    teacherOrAdmin(req.user);
    next();
  } catch (e) {
    res.status(403).json({ __error: e.message });
  }
}

/**
 * ตัวรับไฟล์ร่วมของทุก endpoint — ด่านตรวจอยู่ที่เดียวจะได้ไม่หลุดจุดใดจุดหนึ่ง
 * `allowed` คือรายการนามสกุลที่จุดนั้นยอมรับ (สื่อการสอนรับ PDF/JPEG/PNG)
 */
function receive({ maxMB, allowed, toDisk }) {
  const upload = multer({
    // สื่อการสอน (toDisk) เขียนลงไฟล์พักก่อน แล้ว stream ต่อไปที่เก็บ —
    // memoryStorage ถือไฟล์ทั้งก้อน ครูหลายคนอัปพร้อมกันทำให้ RAM เพิ่มตามจำนวนคน
    // งานสารบรรณยังใช้ memory เพราะเพดานแค่ 10MB และไม่คุ้มที่จะเพิ่มเส้นทางลบไฟล์พัก
    storage: toDisk
      ? multer.diskStorage({
          destination: (req, file, cb) => {
            fsp.mkdir(TMP_DIR, { recursive: true }).then(() => cb(null, TMP_DIR), cb);
          },
          // ชื่อสุ่มล้วน ไม่เอาชื่อที่ผู้ใช้ส่งมาประกอบ — กัน path traversal ตั้งแต่ไฟล์พัก
          filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
        })
      : multer.memoryStorage(),
    limits: { fileSize: maxMB * 1024 * 1024, files: 1, fields: 20 },
  }).single('file');

  // ตรวจ magic bytes จากหัวไฟล์ — อ่านแค่ไม่กี่ไบต์แรก ไม่ต้องโหลดทั้งไฟล์เข้ามา
  const headOf = async (file) => {
    if (file.buffer) return file.buffer;
    const fh = await fsp.open(file.path, 'r');
    try {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await fh.read(buf, 0, 16, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  };

  return (req, res, next) => {
    // ไม่มีที่เก็บถาวร = ไม่รับไฟล์ ดีกว่ารับแล้วหายตอน deploy รอบหน้า
    if (!storage.isConfigured()) {
      return res.status(503).json({
        __error: 'ยังไม่เปิดให้อัปโหลดไฟล์ — แจ้งผู้ดูแลระบบ',
      });
    }
    underBudget(req, res, () => {
      upload(req, res, async (err) => {
        if (err) {
          // multer ลบไฟล์ที่เขียนค้างเมื่อชนเพดาน/ตัดการเชื่อมต่อ; เก็บซ้ำเผื่อ req.file ยังอยู่
          await dropTemp(req.file);
          const msg = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${maxMB} MB` : err.message;
          return res.status(400).json({ __error: msg });
        }
        if (!req.file) return res.status(400).json({ __error: 'ไม่พบไฟล์ที่อัปโหลด' });

        // คิดโควตาทันทีที่อ่านไฟล์จบ ไม่รอว่าจะบันทึกสำเร็จไหม — ไม่งั้นยิงไฟล์ที่ถูกปฏิเสธ
        // รัว ๆ ก็กินแบนด์วิดท์ได้ฟรีไม่จำกัด
        chargeBudget(req, req.file.size);

        // ตัดสินชนิดจาก magic bytes เท่านั้น — MIME กับนามสกุลที่ client ส่งมาเชื่อไม่ได้
        let type;
        try {
          type = types.detect(await headOf(req.file), allowed);
        } catch (e) {
          await dropTemp(req.file);
          return res.status(400).json({ __error: 'อ่านไฟล์ที่อัปโหลดไม่ได้' });
        }
        if (!type) {
          await dropTemp(req.file);
          return res.status(400).json({
            __error: `รองรับเฉพาะไฟล์ ${types.labels(allowed)} — ไฟล์นี้ไม่ใช่`,
          });
        }
        req.file.detectedExt = type.ext;
        req.file.originalname = decodeFilename(req.file.originalname);
        next();
      });
    });
  };
}

// ---------- การ์ดสื่อการสอน ----------

// การ์ดถูกสร้างไว้ก่อนด้วย saveMediaCard (ผ่าน /api/gas) — ที่นี่แค่แนบไฟล์เข้าการ์ดนั้น
// แยกกันเพราะ metadata เป็น JSON ธรรมดาที่ไม่มีเหตุผลต้องมาปนกับ multipart
router.post('/upload/:cardId', requireAuth, guardTeacher,
  receive({ maxMB: mediaCards.MAX_UPLOAD_MB, allowed: mediaCards.ALLOWED_EXTS, toDisk: true }),
  async (req, res) => {
    try {
      res.json({
        __result: await mediaCards.addCardFile(
          { cardId: req.params.cardId, file: req.file }, req.user
        ),
      });
    } catch (e) {
      console.error('[media:upload]', e.message);
      // 507 = พื้นที่ของโรงเรียนเต็ม ซึ่งครูแก้เองได้ (ไปลบของเก่า) ต่างจาก 400 ที่แปลว่าคำขอผิด
      res.status(e.status || 400).json({ __error: e.message });
    } finally {
      // ทุกเส้นทาง — สำเร็จ ล้มเพราะโควตา ล้มเพราะเขียน DB ไม่ได้ — ไฟล์พักต้องไม่ค้าง
      await dropTemp(req.file);
    }
  });

// ---------- ไฟล์แนบงานสารบรรณ ----------

router.post('/sarabun/:id', requireAuth, guardTeacher,
  receive({ maxMB: sarabun.MAX_ATTACH_MB, allowed: types.EXTENSIONS }),
  async (req, res) => {
    try {
      res.json({ __result: await sarabun.attachSarabunFile(req.params.id, req.file, req.user) });
    } catch (e) {
      console.error('[sarabun:attach]', e.message);
      res.status(400).json({ __error: e.message });
    }
  });

router.post('/project/:id', requireAuth, guardTeacher,
  receive({ maxMB: projects.MAX_ATTACH_MB, allowed: types.EXTENSIONS }),
  async (req, res) => {
    try {
      res.json({ __result: await projects.attachProjectFile(req.params.id, req.file, req.user) });
    } catch (e) {
      console.error('[project:attach]', e.message);
      res.status(400).json({ __error: e.message });
    }
  });

// ---------- เสิร์ฟไฟล์เอง (driver disk เท่านั้น) ----------

// media: id ในตั๋วคือ **media_files.id ไม่ใช่ card id** — สิทธิ์อยู่ที่การ์ดแม่จึงต้อง join
// กลับไปเช็ค deleted_at ด้วย ไม่งั้นไฟล์ของการ์ดที่อยู่ในถังขยะยังเปิดได้ด้วยตั๋วที่ออกไว้ก่อน
const SOURCES = {
  media: `SELECT f.file_key, f.file_name
          FROM media_files f JOIN media_cards c ON c.id = f.card_id
          WHERE f.id=$1 AND c.deleted_at IS NULL`,
  sarabun: `SELECT file_key, file_name FROM sarabun WHERE id=$1`,
  project: `SELECT file_key, file_name FROM project_files WHERE id=$1`,
};

// ตัวอ่าน PDF ใช้ route นี้เพื่อให้ pdf.js อ่านผ่าน origin เดียวกับเว็บ — แก้ CORS ของ
// presigned S3/R2 โดยไม่ต้องเปิด bucket เป็นสาธารณะ. ตั๋วออกหลังตรวจสิทธิ์ใน GAS แล้ว.
router.get('/proxy/:kind/:id', async (req, res) => {
  const sql = SOURCES[req.params.kind];
  const id = parseInt(req.params.id, 10);
  if (!sql || !Number.isInteger(id)) return res.status(400).send('คำขอไม่ถูกต้อง');
  let ticket;
  try { ticket = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET); }
  catch { return res.status(401).send('ลิงก์หมดอายุ — กลับไปกดเปิดไฟล์อีกครั้ง'); }
  if (ticket.id !== id || ticket.kind !== req.params.kind || !ticket.reader) {
    return res.status(403).send('ไม่มีสิทธิ์เปิดไฟล์นี้');
  }
  const { rows } = await query(sql, [id]);
  const row = rows[0];
  if (!row || !row.file_key) return res.status(404).send('ไม่พบไฟล์');
  try {
    const file = await storage.getStream(row.file_key);
    const type = types.byExt(types.extOf(row.file_key));
    res.setHeader('Content-Type', type.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `${type.disposition}; filename*=UTF-8''${encodeURIComponent(row.file_name || 'file.' + type.ext)}`);
    if (file.size) res.setHeader('Content-Length', file.size);
    file.stream.on('error', function() { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
    file.stream.pipe(res);
  } catch (err) {
    console.error('[media:proxy]', err.message);
    if (!res.headersSent) res.status(502).send('อ่านไฟล์ไม่สำเร็จ');
  }
});

/**
 * production ใช้ driver `s3` ซึ่งคืน presigned URL ให้เบราว์เซอร์โหลดจาก object storage ตรง
 * route นี้จึงไม่ถูก mount เลย
 *
 * สิทธิ์ถูกตรวจตอน "ออก" ตั๋ว (getMediaFileTicket / getSarabunFileTicket) ไม่ใช่ที่นี่ —
 * window.open แนบ Authorization header ไม่ได้เพราะ JWT อยู่ใน localStorage ไม่ใช่ cookie
 */
if (storage.driverName() === 'disk') router.get('/file/:kind/:id', async (req, res) => {
  const sql = SOURCES[req.params.kind];
  const id = parseInt(req.params.id, 10);
  if (!sql || !Number.isInteger(id)) return res.status(400).send('คำขอไม่ถูกต้อง');

  let ticket;
  try {
    ticket = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
  } catch {
    return res.status(401).send('ลิงก์หมดอายุ — กลับไปกดเปิดไฟล์อีกครั้ง');
  }
  // ตั๋วผูกกับทรัพยากรชิ้นเดียว ใช้ข้ามชิ้นหรือข้ามชนิดไม่ได้
  if (ticket.id !== id || ticket.kind !== req.params.kind) {
    return res.status(403).send('ไม่มีสิทธิ์เปิดไฟล์นี้');
  }

  const { rows } = await query(sql, [id]);
  const row = rows[0];
  if (!row || !row.file_key) return res.status(404).send('ไม่พบไฟล์');

  let stat;
  try {
    stat = storage.disk.statSync(row.file_key);
  } catch {
    return res.status(400).send('ไฟล์ไม่ถูกต้อง');
  }
  if (!stat) return res.status(404).send('ไฟล์หายไปจากที่เก็บ');

  const type = types.byExt(types.extOf(row.file_key));
  res.setHeader('Content-Type', type.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  // private: ให้เบราว์เซอร์ของคนที่เปิดได้ cache แต่ห้าม CDN หรือ proxy เก็บไว้แจกต่อ
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition',
    `${type.disposition}; filename*=UTF-8''${encodeURIComponent(row.file_name || 'file.' + type.ext)}`);

  // Range รองรับเพราะ PDF viewer ของเบราว์เซอร์ขอเป็นช่วง ไม่งั้นไฟล์ใหญ่โหลดทั้งก้อนก่อนแสดง
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return storage.disk.readStream(row.file_key, { start, end }).pipe(res);
    }
  }

  res.setHeader('Content-Length', stat.size);
  storage.disk.readStream(row.file_key).pipe(res);
});

module.exports = router;
// export ไว้ให้เทสต์เรียกตรง — ตัวถอดชื่อไฟล์อยู่ลึกเกินกว่าจะยิงผ่าน HTTP ได้สะดวก
module.exports.decodeFilename = decodeFilename;
