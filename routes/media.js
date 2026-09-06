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
 *   POST /api/media/upload/:cardId  แนบไฟล์เข้าการ์ดสื่อการสอน — PDF/JPEG/PNG 25MB ต่อไฟล์
 *   POST /api/media/sarabun/:id     ไฟล์แนบงานสารบรรณ — PDF/JPEG/PNG/DOCX 10MB
 *   GET  /api/media/file/:kind/:id  เสิร์ฟไฟล์เอง — **เฉพาะ driver disk (dev)**
 *
 * การ์ดสื่อรับ **ทีละไฟล์** ถึงจะอัปหลายใบพร้อมกันในหน้าเดียว — client ยิงเรียงกันเอง
 * multer ใช้ memoryStorage() ไฟล์อยู่ใน RAM ทั้งก้อน รับ 30 ไฟล์ใน request เดียว
 * = 750MB เข้า memory ครั้งเดียว Railway ตาย · แถมล้มใบเดียวไม่ล้มทั้งชุด
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

/**
 * โควตาต่อคนต่อชั่วโมง — **นับเป็นไบต์ ไม่ใช่จำนวนครั้ง**
 *
 * เจตนาเดิมคือกันพื้นที่เก็บที่ใช้ร่วมกันทั้งโรงเรียน ไม่ใช่กันจำนวนครั้ง ·
 * ตอนที่การ์ดหนึ่งใบ = ไฟล์หนึ่งใบ นับครั้งก็ได้ผลเท่ากัน แต่พอการ์ดใบเดียวมีได้ 30 ไฟล์
 * เพดาน 20 ครั้ง/ชม. จะชนตั้งแต่ใบที่ 21 = อัปหนังสือทั้งเล่มไม่ได้เลย
 */
const RATE_LIMIT = { maxBytes: 500 * 1024 * 1024, windowSec: 3600 };

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
    underBudget(req, res, () => {
      upload(req, res, (err) => {
        if (err) {
          const msg = err.code === 'LIMIT_FILE_SIZE' ? `ไฟล์ใหญ่เกิน ${maxMB} MB` : err.message;
          return res.status(400).json({ __error: msg });
        }
        if (!req.file) return res.status(400).json({ __error: 'ไม่พบไฟล์ที่อัปโหลด' });

        // คิดโควตาทันทีที่อ่านไฟล์จบ ไม่รอว่าจะบันทึกสำเร็จไหม — ไม่งั้นยิงไฟล์ที่ถูกปฏิเสธ
        // รัว ๆ ก็กินแบนด์วิดท์กับ RAM ได้ฟรีไม่จำกัด
        chargeBudget(req, req.file.size);

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

// การ์ดถูกสร้างไว้ก่อนด้วย saveMediaCard (ผ่าน /api/gas) — ที่นี่แค่แนบไฟล์เข้าการ์ดนั้น
// แยกกันเพราะ metadata เป็น JSON ธรรมดาที่ไม่มีเหตุผลต้องมาปนกับ multipart
router.post('/upload/:cardId', requireAuth, guardTeacher,
  receive({ maxMB: mediaCards.MAX_UPLOAD_MB, allowed: mediaCards.ALLOWED_EXTS }),
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

// media: id ในตั๋วคือ **media_files.id ไม่ใช่ card id** — สิทธิ์อยู่ที่การ์ดแม่จึงต้อง join
// กลับไปเช็ค deleted_at ด้วย ไม่งั้นไฟล์ของการ์ดที่อยู่ในถังขยะยังเปิดได้ด้วยตั๋วที่ออกไว้ก่อน
const SOURCES = {
  media: `SELECT f.file_key, f.file_name
          FROM media_files f JOIN media_cards c ON c.id = f.card_id
          WHERE f.id=$1 AND c.deleted_at IS NULL`,
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
