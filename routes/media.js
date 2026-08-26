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
const drive = require('../lib/drive');

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

  if (!drive.isConfigured()) {
    return res.status(503).json({
      __error: 'ระบบยังไม่ได้เชื่อมต่อ Google Drive — แจ้งผู้ดูแลระบบ (การ์ดแบบลิงก์ยังใช้ได้ปกติ)',
    });
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

module.exports = router;
// export ไว้ให้เทสต์เรียกตรง — ตัวตรวจนี้อยู่หลังด่าน isConfigured จึงยิงผ่าน HTTP ไม่ถึง
module.exports.looksLikePdf = looksLikePdf;
