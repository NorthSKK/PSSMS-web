'use strict';
/**
 * อัปโหลดไฟล์สื่อการสอน — REST endpoint ตัวเดียวของ repo นี้
 *
 * ที่เหลือทั้งระบบคุยผ่าน shim `google.script.run` → POST /api/gas/<fnName> ซึ่งรับแต่ JSON
 * ไฟล์ binary ไม่เข้ากับทางนั้น: จะส่งต้องแปลงเป็น base64 (บวม 33%) และต้องดัน
 * `express.json` limit ที่ server.js เป็น global ขึ้นเป็นหลายสิบ MB ซึ่งเปิดช่อง DoS
 * ให้ทุก endpoint ที่เหลือ
 *
 * เส้นแบ่งจึงเป็น: **binary ไป REST, ที่เหลือไป /api/gas**
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();

const requireAuth = require('../middleware/auth');
const { teacherOrAdmin } = require('../lib/permissions');
const cache = require('../lib/cache');
const mediaCards = require('../functions/mediaCards');
const store = require('../lib/fileStore');
const jwt = require('jsonwebtoken');
const { query } = require('../lib/db');

const MAX_BYTES = mediaCards.MAX_UPLOAD_MB * 1024 * 1024;

// memoryStorage: ไฟล์ไม่แตะดิสก์ของ Railway ซึ่งเป็น filesystem ชั่วคราวอยู่แล้ว
// ขนาดจำกัดที่ 25MB จึงถือใน RAM ได้ และไปต่อ Drive ทันที
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 20 },
  fileFilter(req, file, cb) {
    // MIME จาก client เชื่อไม่ได้ แต่คัดชั้นแรกไว้ก่อนจะได้ไม่ต้องอ่านไฟล์ทั้งก้อน
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('รองรับเฉพาะไฟล์ PDF'));
    }
    cb(null, true);
  },
});

// จำกัดจำนวนครั้งต่อคน — โควตา Drive มี 15GB ก้อนเดียวใช้ร่วมกันทั้งโรงเรียน
// คนเดียวยิงรัวจนเต็มได้ถ้าไม่กั้น
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
    if (utf8.includes('\uFFFD')) return raw;
    return Buffer.from(utf8, 'utf8').toString('latin1') === raw ? utf8 : raw;
  } catch {
    return raw;
  }
}

// ตรวจว่าเป็น PDF จริงจาก magic bytes ไม่ใช่จากนามสกุลหรือ MIME ที่ client บอกมา
function looksLikePdf(buffer) {
  return !!buffer && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

router.post('/upload', requireAuth, (req, res) => {
  try {
    teacherOrAdmin(req.user);
  } catch (e) {
    return res.status(403).json({ __error: e.message });
  }

  rateLimit(req, res, () => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE'
          ? `ไฟล์ใหญ่เกิน ${mediaCards.MAX_UPLOAD_MB} MB — บีบอัด PDF ก่อนแล้วลองใหม่`
          : err.message;
        return res.status(400).json({ __error: msg });
      }
      if (!req.file) return res.status(400).json({ __error: 'ไม่พบไฟล์ที่อัปโหลด' });
      if (!looksLikePdf(req.file.buffer)) {
        return res.status(400).json({ __error: 'ไฟล์นี้ไม่ใช่ PDF จริง' });
      }

      let payload;
      try {
        payload = JSON.parse(req.body.payload || '{}');
      } catch {
        return res.status(400).json({ __error: 'ข้อมูลการ์ดไม่ถูกต้อง' });
      }

      req.file.originalname = decodeFilename(req.file.originalname);

      try {
        const result = await mediaCards.createPdfCard({ payload, file: req.file }, req.user);
        res.json({ __result: result });
      } catch (e) {
        console.error('[media:upload]', e.message);
        res.status(400).json({ __error: e.message });
      }
    });
  });
});

/**
 * เสิร์ฟไฟล์ PDF ของการ์ด — ต้องมีตั๋วจาก getMediaFileTicket
 *
 * ไฟล์ไม่ได้เปิดสาธารณะ ต่างจากตอนที่เคยใช้ลิงก์ Google Drive: ที่นี่คนที่เปิดได้
 * คือคนที่ผ่านการตรวจสิทธิ์ตอนขอตั๋วเท่านั้น และตั๋วอายุ 10 นาที
 *
 * รองรับ Range เพราะ PDF viewer ของเบราว์เซอร์ขอเป็นช่วง ไม่งั้นไฟล์ใหญ่จะโหลดทั้งก้อน
 * ก่อนแสดงหน้าแรก
 */
router.get('/file/:id', async (req, res) => {
  const cardId = parseInt(req.params.id, 10);
  if (!Number.isInteger(cardId)) return res.status(400).send('คำขอไม่ถูกต้อง');

  let ticket;
  try {
    ticket = jwt.verify(String(req.query.t || ''), process.env.JWT_SECRET);
  } catch {
    return res.status(401).send('ลิงก์หมดอายุ — กลับไปกดเปิดไฟล์จากหน้าสื่อการสอนอีกครั้ง');
  }
  // ตั๋วผูกกับการ์ดใบเดียว ใช้ข้ามการ์ดไม่ได้
  if (ticket.cardId !== cardId) return res.status(403).send('ไม่มีสิทธิ์เปิดไฟล์นี้');

  const { rows } = await query(
    `SELECT file_key, file_name FROM media_cards
     WHERE id=$1 AND deleted_at IS NULL AND card_type='pdf'`, [cardId]
  );
  const card = rows[0];
  if (!card || !card.file_key) return res.status(404).send('ไม่พบไฟล์');

  let stat;
  try {
    stat = store.statSync(card.file_key);
  } catch {
    return res.status(400).send('ไฟล์ไม่ถูกต้อง');
  }
  if (!stat) return res.status(404).send('ไฟล์หายไปจากที่เก็บ');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Accept-Ranges', 'bytes');
  // private: ให้เบราว์เซอร์ของคนที่เปิดได้ cache แต่ห้าม CDN หรือ proxy เก็บไว้แจกต่อ
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(card.file_name || 'media.pdf')}`);

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
      return store.readStream(card.file_key, { start, end }).pipe(res);
    }
  }

  res.setHeader('Content-Length', stat.size);
  store.readStream(card.file_key).pipe(res);
});

module.exports = router;
// export ไว้ให้เทสต์เรียกตรง — ตัวตรวจนี้อยู่หลังด่าน isConfigured จึงยิงผ่าน HTTP ไม่ถึง
module.exports.looksLikePdf = looksLikePdf;
module.exports.decodeFilename = decodeFilename;
