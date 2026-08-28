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
 *   POST /api/media/upload          การ์ดสื่อการสอน — PDF เท่านั้น 25MB
 *   POST /api/media/sarabun/:id     ไฟล์แนบงานสารบรรณ — PDF/JPEG/PNG/DOCX 10MB
 *   GET  /api/media/file/:kind/:id  เสิร์ฟไฟล์เอง — **เฉพาะ driver disk (dev)**
 */
const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const { teacherOrAdmin } = require('../lib/permissions');
const cache = require('../lib/cache');
const { query } = require('../lib/db');
const mediaCards = require('../functions/mediaCards');
const sarabun = require('../functions/sarabun');
const storage = require('../lib/storage');
const types = require('../lib/storage/types');

// จำกัดจำนวนครั้งต่อคน — พื้นที่เก็บใช้ร่วมกันทั้งโรงเรียน คนเดียวยิงรัวจนเต็มได้ถ้าไม่กั้น
const RATE_LIMIT = { max: 20, windowSec: 3600 };

function rateLimit(req, res, next) {
  const key = `media_upload_${String(req.user?.id || '').toLowerCase()}`;
  const used = cache.get(key) || 0;
  if (used >= RATE_LIMIT.max) {
    return res.status(429).json({
      __error: `อัปโหลดเกิน ${RATE_LIMIT.max} ไฟล์ต่อชั่วโมงแล้ว รอสักครู่แล้วลองใหม่`,
    });
  }
  cache.set(key, used + 1, RATE_LIMIT.windowSec);
  next();
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
 * `allowed` คือรายการนามสกุลที่จุดนั้นยอมรับ (สื่อการสอนรับแค่ pdf)
 */
function receive({ maxMB, allowed }) {
  const upload = multer({
    // memoryStorage: ไฟล์ไม่แตะดิสก์ของ Railway ซึ่งเป็น filesystem ชั่วคราวอยู่แล้ว
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMB * 1024 * 1024, files: 1, fields: 20 },
  }).single('file');

  return (req, res, next) => {
    // ไม่มีที่เก็บถาวร = ไม่รับไฟล์ ดีกว่ารับแล้วหายตอน deploy รอบหน้า
    if (!storage.isConfigured()) {
      return res.status(503).json({
        __error: 'ยังไม่เปิดให้อัปโหลดไฟล์ — แจ้งผู้ดูแลระบบ',
      });
    }
    rateLimit(req, res, () => {
      upload(req, res, (err) => {
        if (err) {
          const msg = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${maxMB} MB` : err.message;
          return res.status(400).json({ __error: msg });
        }
        if (!req.file) return res.status(400).json({ __error: 'ไม่พบไฟล์ที่อัปโหลด' });

        // ตัดสินชนิดจาก magic bytes เท่านั้น — MIME กับนามสกุลที่ client ส่งมาเชื่อไม่ได้
        const type = types.detect(req.file.buffer, allowed);
        if (!type) {
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

router.post('/upload', requireAuth, guardTeacher,
  receive({ maxMB: mediaCards.MAX_UPLOAD_MB, allowed: ['pdf'] }),
  async (req, res) => {
    let payload;
    try {
      payload = JSON.parse(req.body.payload || '{}');
    } catch {
      return res.status(400).json({ __error: 'ข้อมูลการ์ดไม่ถูกต้อง' });
    }
    try {
      res.json({ __result: await mediaCards.createPdfCard({ payload, file: req.file }, req.user) });
    } catch (e) {
      console.error('[media:upload]', e.message);
      res.status(400).json({ __error: e.message });
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

// ---------- เสิร์ฟไฟล์เอง (driver disk เท่านั้น) ----------

const SOURCES = {
  media: `SELECT file_key, file_name FROM media_cards
          WHERE id=$1 AND deleted_at IS NULL AND card_type='pdf'`,
  sarabun: `SELECT file_key, file_name FROM sarabun WHERE id=$1`,
};

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
