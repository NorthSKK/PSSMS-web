'use strict';
/**
 * สื่อการสอน — การ์ดที่ครูเพิ่มเองได้บนหน้า Page_Teaching_Media
 *
 * การ์ดมี 2 ชนิด: `link` (แปะลิงก์เว็บ) และ `files` (ถือไฟล์ได้หลายใบ)
 * ไฟล์ของการ์ด `files` อยู่ในตาราง `media_files` **ไม่ใช่บนแถวของการ์ด** —
 * การ์ดใบเดียวจึงเป็นชุดสื่อทั้งชุด (หนังสือ 14 บท, ใบงานสแกน 30 หน้า)
 * ที่คนอ่านเปิดดูในหน้าเดิมแล้วสลับไฟล์จากสารบัญได้ ไม่ต้องเด้งแท็บทีละใบ
 *
 * กติกาการมองเห็น (สำคัญ — เป็นจุดที่บั๊กแล้วเงียบที่สุดของฟีเจอร์นี้):
 *   - ครูและ Admin เห็นทุกใบเสมอ
 *   - นักเรียนเห็นเฉพาะใบที่ระดับชั้นตัวเองอยู่ใน visible_levels
 *   - visible_levels ว่าง = ครูเท่านั้น (ค่า default ตอนสร้างการ์ด) — กันเฉลย/ข้อสอบหลุด
 *   - **สิทธิ์อยู่ที่การ์ด ไม่มีสิทธิ์รายไฟล์** ทุกไฟล์ในการ์ดใบเดียวกันเห็นได้เท่ากัน
 *     (สิทธิ์รายไฟล์จะเกิดเคส "การ์ดเห็น แต่ไฟล์ที่ 7 ไม่เห็น" ที่ครูตั้งผิดแล้วไม่รู้ตัว —
 *     อยากแยกให้แยกการ์ด)
 *   - กรองที่ SQL เสมอ ห้ามส่งการ์ดที่นักเรียนไม่ควรเห็นออกไปแล้วค่อยซ่อนฝั่ง client
 *
 * ⚠️ ระดับชั้นของนักเรียนต้อง query สดจาก users.department ทุกครั้ง
 *    ห้ามใช้ user.dept ที่ติดมากับ JWT — token อายุ 90 วัน (routes/gas.js) เด็กเลื่อนชั้น
 *    แล้ว dept ใน token จะค้างชั้นเก่าเกือบ 3 เดือน สิทธิ์การมองเห็นจะผิดทั้งต้นปีการศึกษา
 *
 * ทุกค่าที่ไปโผล่ใน attribute ของ HTML (icon, color, url) validate ด้วย allowlist ที่นี่
 * ไม่ใช่พึ่ง escape ฝั่ง client อย่างเดียว — โดยเฉพาะ url ที่ escape ช่วยอะไรไม่ได้กับ javascript:
 */
const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');
const { SUBJECT_GROUP_BY_PREFIX } = require('../lib/subjectGroup');
const storage = require('../lib/storage');
const types = require('../lib/storage/types');

// กลุ่มสาระ 8 กลุ่ม + กิจกรรมพัฒนาผู้เรียน — ใช้ค่าเดียวกับ subjectGroup.js จะได้ไม่มี 2 ชุด
const SUBJECT_GROUPS = Array.from(new Set(Object.values(SUBJECT_GROUP_BY_PREFIX)));

const LEVELS = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];

// ไอคอนที่ให้ครูเลือก — สั้นพอให้กดเลือกจาก grid ได้จริง และเป็น allowlist ตอน validate
const ICONS = [
  'fa-book-open-reader', 'fa-book', 'fa-graduation-cap', 'fa-chalkboard-user',
  'fa-heart-pulse', 'fa-futbol', 'fa-scale-balanced', 'fa-landmark',
  'fa-flask', 'fa-microscope', 'fa-atom', 'fa-dna',
  'fa-calculator', 'fa-square-root-variable', 'fa-language', 'fa-feather-pointed',
  'fa-palette', 'fa-music', 'fa-laptop-code', 'fa-pen-ruler',
  'fa-file-pdf', 'fa-video', 'fa-link', 'fa-lightbulb',
];

// สีทั้งหมดเข้มพอให้ตัวหนังสือขาวอ่านออก และผ่านทั้ง light/dark theme ของ Styles.html
const COLORS = [
  '#00897b', '#1565c0', '#2e7d32', '#6a1b9a',
  '#c62828', '#8a3324', '#ef6c00', '#37474f',
];

// ค่าเริ่มต้นตามกลุ่มสาระ — ฟอร์มใช้ preselect ให้ครูที่ไม่อยากเลือกเอง
const GROUP_DEFAULTS = {
  'ภาษาไทย':                        { icon: 'fa-feather-pointed', color: '#c62828' },
  'คณิตศาสตร์':                      { icon: 'fa-calculator',      color: '#1565c0' },
  'วิทยาศาสตร์และเทคโนโลยี':          { icon: 'fa-flask',           color: '#2e7d32' },
  'สังคมศึกษา ศาสนา และวัฒนธรรม':     { icon: 'fa-scale-balanced',  color: '#8a3324' },
  'สุขศึกษาและพลศึกษา':               { icon: 'fa-heart-pulse',     color: '#00897b' },
  'ศิลปะ':                          { icon: 'fa-palette',         color: '#6a1b9a' },
  'การงานอาชีพ':                     { icon: 'fa-pen-ruler',       color: '#ef6c00' },
  'ภาษาต่างประเทศ':                   { icon: 'fa-language',        color: '#1565c0' },
  'กิจกรรมพัฒนาผู้เรียน':              { icon: 'fa-lightbulb',       color: '#37474f' },
};

const MAX = { title: 120, meta: 60, description: 300, url: 2000, label: 120 };

// 25MB ต่อไฟล์ — สื่อการสอนสแกนทั้งเล่มใหญ่กว่านี้ ควรบีบอัดก่อน
const MAX_UPLOAD_MB = 25;

// ชนิดไฟล์ที่การ์ดสื่อรับ — ไม่รับ docx เพราะ types.js เสิร์ฟเป็น attachment (บังคับดาวน์โหลด)
// เปิดดูในหน้าเดิมไม่ได้เลย ใส่เข้าไปก็เป็นหลุมในสารบัญ · ปล่อยให้เป็นของงานสารบรรณ
const ALLOWED_EXTS = ['pdf', 'jpg', 'png'];

// เพดานต่อการ์ด — กันการ์ดเดียวโตจนสารบัญเลื่อนหาไม่เจอ และกันคนอัปรัวจนพื้นที่เต็ม
const MAX_FILES_PER_CARD = 50;

/**
 * อายุลิงก์เปิดไฟล์ของสื่อการสอน — ยาวกว่าของงานสารบรรณโดยตั้งใจ
 *
 * PDF viewer ของเบราว์เซอร์โหลดไฟล์ใหญ่แบบ **Range request ทยอยขอตอนเลื่อน**
 * ไม่ได้ดึงทีเดียวจบ · โหมดอ่านในหน้าเดิมคนเปิดค้างนาน ตั๋วหมดอายุระหว่างอ่าน
 * = range request ยิงด้วย URL ที่ตายแล้ว → PDF ค้างกลางเล่มโดยไม่มีข้อความบอก
 *
 * ราคาที่ยอมจ่าย: URL ที่หลุดออกไปใช้ได้ 1 ชม.
 */
const MEDIA_URL_TTL_SECONDS = 3600;

// ถังขยะ — ลบแล้วกู้คืนได้กี่วันก่อนหายถาวร (ทั้งแถวและไฟล์)
const TRASH_DAYS = 30;

// โควตาพื้นที่ของโรงเรียน — อ่านจาก env ทุกครั้ง เพราะแต่ละโรงเรียน bucket คนละขนาด
function quotaBytes() {
  const gb = Number(process.env.MEDIA_QUOTA_GB || 15);
  return (gb > 0 ? gb : 15) * 1024 * 1024 * 1024;
}

function _role(user) {
  return String(user?.role || '').trim().toUpperCase();
}

function _isStaff(user) {
  const r = _role(user);
  return r === 'ADMIN' || r === 'TEACHER';
}

// 'ม.2/1' → 'ม.2' — รองรับช่องว่างแปลก ๆ ที่ import มาจาก CSV
function levelOf(className) {
  const m = String(className || '').match(/ม\s*\.\s*([1-6])/);
  return m ? `ม.${m[1]}` : '';
}

// ระดับชั้นปัจจุบันจาก DB — ห้ามอ่านจาก JWT (ดูหมายเหตุหัวไฟล์)
async function _studentLevel(user) {
  const username = String(user?.id || '').trim();
  if (!username) return '';
  const { rows } = await query(`SELECT department FROM users WHERE username=$1`, [username]);
  return levelOf(rows[0] && rows[0].department);
}

/** ด่านเดียวที่ตัดสินว่า "คนนี้เห็นการ์ดใบนี้ไหม" — ใช้ทั้งตอนขอสารบัญและตอนขอตั๋ว */
async function _assertCanSee(card, user) {
  if (_isStaff(user)) return;
  const level = await _studentLevel(user);
  if (!level || !(card.visible_levels || []).includes(level)) {
    throw new Error('ไม่มีสิทธิ์เปิดไฟล์นี้');
  }
}

function _toClient(row, user) {
  return {
    id: row.id,
    title: row.title,
    group: row.subject_group,
    icon: row.icon,
    color: row.color,
    meta: row.meta,
    desc: row.description,
    url: row.url,
    cardType: row.card_type,
    visibleLevels: row.visible_levels || [],
    isFeatured: row.is_featured,
    createdBy: row.created_by,
    deletedAt: row.deleted_at || null,
    // หน้ารวมได้แค่ตัวเลขสรุป สารบัญขอทีหลังด้วย getMediaCardFiles — ดูหมายเหตุที่ FROM_CARDS
    fileCount: Number(row.file_count || 0),
    totalSize: Number(row.total_size || 0),
    // คำนวณที่ server — client จะได้ไม่ต้องรู้กติกาสิทธิ์ซ้ำอีกชุด
    canEdit: isAdmin(user) || String(row.created_by || '') === String(user?.id || ''),
  };
}

function _fileToClient(row) {
  return {
    id: row.id,
    name: row.file_name,
    // label ว่าง = ยังไม่ได้ตั้งชื่อเอง ใช้ชื่อไฟล์เดิมไปก่อน (ล้าง label = กลับไปใช้ชื่อไฟล์)
    label: row.label || row.file_name,
    size: Number(row.file_size || 0),
    // client ใช้ตัดสินว่าจะเรนเดอร์ด้วย <iframe> (pdf) หรือ <img> (รูป)
    ext: types.extOf(row.file_key),
  };
}

const SELECT_COLS = `c.id, c.title, c.subject_group, c.icon, c.color, c.meta, c.description,
                     c.url, c.card_type, c.visible_levels, c.is_featured, c.created_by,
                     c.deleted_at,
                     COALESCE(f.n, 0)::int AS file_count,
                     COALESCE(f.total, 0)::bigint AS total_size`;

/**
 * หน้ารวมได้แค่ "กี่ไฟล์ รวมกี่ไบต์" ไม่ได้สารบัญมาด้วย
 * โรงเรียนที่มี 50 การ์ด × 30 ไฟล์ = 1,500 แถวยัดมาทุกครั้งที่เข้าเมนู
 * สารบัญขอตอนกดเปิดอ่าน (getMediaCardFiles) ซึ่งเสีย 1 round-trip ที่เร็วกว่าโหลดไฟล์อยู่แล้ว
 */
const FROM_CARDS = `FROM media_cards c
                    LEFT JOIN (SELECT card_id, count(*) AS n, sum(file_size) AS total
                               FROM media_files GROUP BY card_id) f ON f.card_id = c.id`;

const ORDER_CARDS = `ORDER BY c.is_featured DESC, c.created_at DESC, c.id DESC`;

async function getMediaCards(_args, user) {
  if (_isStaff(user)) {
    const { rows } = await query(
      `SELECT ${SELECT_COLS} ${FROM_CARDS} WHERE c.deleted_at IS NULL ${ORDER_CARDS}`
    );
    return rows.map(r => _toClient(r, user));
  }

  const level = await _studentLevel(user);
  if (!level) return [];
  // การ์ด files ที่ยังไม่มีไฟล์ = ครูสร้างค้างไว้ · นักเรียนกดแล้วเจอความว่างเปล่า จึงไม่ส่งไป
  // ครูยังเห็น (query ข้างบน) จะได้รู้ว่าค้างแล้วมาอัปต่อ
  const { rows } = await query(
    `SELECT ${SELECT_COLS} ${FROM_CARDS}
     WHERE c.deleted_at IS NULL AND $1 = ANY(c.visible_levels)
       AND (c.card_type <> 'files' OR COALESCE(f.n, 0) > 0)
     ${ORDER_CARDS}`,
    [level]
  );
  return rows.map(r => _toClient(r, user));
}

function _str(v, field) {
  const s = String(v == null ? '' : v).trim();
  if (MAX[field] && s.length > MAX[field]) {
    throw new Error(`ข้อความยาวเกิน ${MAX[field]} ตัวอักษร`);
  }
  return s;
}

// ยอมเฉพาะ http/https — javascript: และ data: เป็นทางเข้า XSS ที่ escape ฝั่ง client กันไม่ได้
function _validUrl(raw) {
  const url = _str(raw, 'url');
  if (!url) throw new Error('กรุณาใส่ลิงก์');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย http:// หรือ https://');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('รองรับเฉพาะลิงก์ http:// และ https://');
  }
  return url;
}

function _validLevels(raw) {
  if (!Array.isArray(raw)) return [];
  const picked = raw.map(v => String(v || '').trim()).filter(v => LEVELS.includes(v));
  return LEVELS.filter(l => picked.includes(l)); // เรียงตาม ม.1→ม.6 เสมอ ไม่ตามลำดับที่ครูกด
}

// การ์ด files ไม่มี url จากครู จึงแยกส่วนที่ใช้ร่วมกันออกมา
function _normalizeMeta(payload, user) {
  const p = payload || {};
  const group = _str(p.group, 'group');
  if (group && !SUBJECT_GROUPS.includes(group)) throw new Error('กลุ่มสาระไม่ถูกต้อง');

  const fallback = GROUP_DEFAULTS[group] || {};
  const icon = _str(p.icon, 'icon') || fallback.icon || 'fa-book-open-reader';
  if (!ICONS.includes(icon)) throw new Error('ไอคอนไม่ถูกต้อง');

  const color = _str(p.color, 'color').toLowerCase() || fallback.color || '#00897b';
  if (!COLORS.includes(color)) throw new Error('สีไม่ถูกต้อง');

  const title = _str(p.title, 'title');
  if (!title) throw new Error('กรุณาใส่ชื่อสื่อ');

  return {
    title,
    group,
    icon,
    color,
    meta: _str(p.meta, 'meta'),
    desc: _str(p.desc, 'description'),
    levels: _validLevels(p.visibleLevels),
    // ปักหมุดเป็นเครื่องมือจัดหน้ารวมของทั้งโรงเรียน ไม่ใช่ของครูคนเดียว
    isFeatured: isAdmin(user) ? !!p.isFeatured : false,
  };
}

function _normalize(payload, user) {
  return { ..._normalizeMeta(payload, user), url: _validUrl(payload && payload.url) };
}

// ครูแก้/ลบได้เฉพาะการ์ดตัวเอง Admin ทำได้หมด — คืนแถวเดิมไว้ให้ผู้เรียกใช้ต่อ
async function _loadOwned(id, user) {
  const cardId = parseInt(id, 10);
  if (!Number.isInteger(cardId)) throw new Error('ไม่พบการ์ดนี้');
  const { rows } = await query(
    `SELECT id, created_by, is_featured, deleted_at, card_type, url
     FROM media_cards WHERE id=$1`, [cardId]
  );
  const row = rows[0];
  if (!row) throw new Error('ไม่พบการ์ดนี้');
  if (!isAdmin(user) && String(row.created_by || '') !== String(user?.id || '')) {
    throw new Error('แก้ไขได้เฉพาะการ์ดที่ตัวเองเพิ่ม');
  }
  return row;
}

async function saveMediaCard([payload], user) {
  const id = payload && payload.id;

  if (id) {
    const existing = await _loadOwned(id, user);
    // ชนิดการ์ดเปลี่ยนทีหลังไม่ได้ — การ์ด files ไม่มี url ให้แก้ (ไฟล์จัดการแยกต่างหาก)
    const c = existing.card_type === 'files'
      ? { ..._normalizeMeta(payload, user), url: '' }
      : _normalize(payload, user);
    // ครูแก้การ์ดปักหมุดของโรงเรียนได้ถ้าเป็นเจ้าของ แต่ห้ามถอด/ติดหมุดเอง
    const featured = isAdmin(user) ? c.isFeatured : existing.is_featured;
    await query(
      `UPDATE media_cards
       SET title=$1, subject_group=$2, icon=$3, color=$4, meta=$5, description=$6,
           url=$7, visible_levels=$8, is_featured=$9, updated_at=NOW()
       WHERE id=$10`,
      [c.title, c.group, c.icon, c.color, c.meta, c.desc, c.url, c.levels, featured, existing.id]
    );
    return { status: 'success', id: existing.id, message: 'บันทึกการ์ดเรียบร้อย' };
  }

  // การ์ด files ถูกสร้าง "เปล่า" ก่อน แล้วครูอัปไฟล์ตามทีละใบ (ดู addCardFile)
  // ปิดหน้ากลางคัน = ได้การ์ดเปล่าที่นักเรียนไม่เห็น ครูลบเองได้ — ดีกว่าทำ staging
  // ที่ต้องมีตัวกวาดของตัวเองอีกชุด
  const cardType = String(payload && payload.cardType) === 'files' ? 'files' : 'link';
  const c = cardType === 'files'
    ? { ..._normalizeMeta(payload, user), url: '' }
    : _normalize(payload, user);
  if (cardType === 'files' && !storage.isConfigured()) {
    throw new Error('ยังไม่เปิดให้อัปโหลดไฟล์ — แจ้งผู้ดูแลระบบ');
  }
  const { rows } = await query(
    `INSERT INTO media_cards
       (title, subject_group, icon, color, meta, description, url, card_type,
        visible_levels, is_featured, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [c.title, c.group, c.icon, c.color, c.meta, c.desc, c.url, cardType, c.levels, c.isFeatured,
     String(user?.id || '')]
  );
  return { status: 'success', id: rows[0].id, cardType, message: 'เพิ่มการ์ดเรียบร้อย' };
}

// ---------------------------------------------------------------- ไฟล์ในการ์ด

/** พื้นที่ที่ใช้ไปทั้งโรงเรียน — รวมไฟล์ของการ์ดในถังขยะด้วย เพราะมันยังกินที่จริง */
async function _usedBytes() {
  const { rows } = await query(`SELECT COALESCE(sum(file_size), 0)::bigint AS used FROM media_files`);
  return Number(rows[0].used);
}

/**
 * เพิ่มไฟล์เข้าการ์ดที่มีอยู่แล้ว — เรียกจาก routes/media.js เท่านั้น (multipart ไม่ผ่าน /api/gas)
 *
 * ยิงทีละไฟล์ ไม่ใช่ request เดียวหลายไฟล์: multer ใช้ memoryStorage() ไฟล์อยู่ใน RAM
 * ทั้งก้อน 30 ไฟล์ × 25MB = 750MB เข้า memory ครั้งเดียว Railway ตาย
 * แถมล้มใบเดียวไม่ล้มทั้งชุด retry เฉพาะใบที่พลาดได้
 *
 * ตรวจให้ครบ *ก่อน* เอาไฟล์ขึ้นที่เก็บเสมอ ไม่งั้นไฟล์ขึ้นไปกองโดยไม่มีแถวชี้ถึง
 * = ไฟล์กำพร้าที่กินโควตาเงียบ ๆ
 */
async function addCardFile({ cardId, file }, user) {
  const card = await _loadOwned(cardId, user);
  if (card.card_type !== 'files') throw new Error('การ์ดนี้เป็นแบบลิงก์ แนบไฟล์ไม่ได้');
  if (card.deleted_at) throw new Error('การ์ดนี้อยู่ในถังขยะ กู้คืนก่อนจึงจะเพิ่มไฟล์ได้');
  if (!file || !file.buffer || !file.buffer.length) throw new Error('ไม่พบไฟล์ที่อัปโหลด');

  const { rows: agg } = await query(
    `SELECT count(*)::int AS n, COALESCE(max(sort_order), -1)::int AS last
     FROM media_files WHERE card_id=$1`, [card.id]
  );
  if (agg[0].n >= MAX_FILES_PER_CARD) {
    throw new Error(`การ์ดหนึ่งใบใส่ได้ไม่เกิน ${MAX_FILES_PER_CARD} ไฟล์ — แยกเป็นอีกการ์ด`);
  }

  // โควตารวมของโรงเรียน — เดิมพึ่ง rate limit นับจำนวนครั้งกั้นทางอ้อม พอเปลี่ยนไปนับ MB
  // ด่านนั้นหายไป ถ้าไม่กั้นตรงนี้จะรู้ตัวว่าเต็มตอนบิลมา หรือตอนอัปพังแบบไม่มีคำอธิบาย
  const used = await _usedBytes();
  const quota = quotaBytes();
  if (used + file.buffer.length > quota) {
    const err = new Error(
      `พื้นที่เก็บไฟล์ของโรงเรียนเต็ม (โควตา ${(quota / 1024 ** 3).toFixed(0)} GB) — ` +
      'ลบสื่อเก่าที่ไม่ใช้แล้วออกจากถังขยะก่อน'
    );
    err.status = 507;
    throw err;
  }

  const saved = await storage.put({ buffer: file.buffer, ext: file.detectedExt });
  const name = file.originalname || `file.${file.detectedExt}`;
  try {
    // label ว่างไว้ก่อน = ใช้ชื่อไฟล์เดิมไปพลาง ครูมาตั้งชื่อในสารบัญทีหลังได้
    // (บังคับตั้งชื่อตอนอัปจะทำให้อัป 30 ไฟล์รวดไม่ได้ ซึ่งเป็นเหตุผลทั้งหมดของฟีเจอร์นี้)
    const { rows } = await query(
      `INSERT INTO media_files (card_id, file_key, file_name, label, file_size, sort_order)
       VALUES ($1,$2,$3,'',$4,$5) RETURNING id`,
      [card.id, saved.key, name, saved.size, agg[0].last + 1]
    );
    await query(`UPDATE media_cards SET updated_at=NOW() WHERE id=$1`, [card.id]);
    return {
      status: 'success', id: rows[0].id, cardId: card.id,
      name, size: saved.size, message: 'อัปโหลดเรียบร้อย',
    };
  } catch (err) {
    // เขียนตารางไม่สำเร็จหลังไฟล์ขึ้นที่เก็บแล้ว — เก็บกวาดทิ้ง อย่าปล่อยไฟล์กำพร้ากินพื้นที่
    await storage.remove(saved.key).catch(() => {});
    throw err;
  }
}

/**
 * สารบัญของการ์ดใบเดียว — ขอตอนกดเปิดอ่าน ไม่ได้ติดมากับหน้ารวม
 *
 * คืนตั๋วของไฟล์ที่จะเปิดก่อนมาให้ในรอบเดียวกันด้วย (`wantFileId` = ไฟล์ที่คนอ่าน
 * ค้างไว้ครั้งก่อน ไม่ส่งมา = ไฟล์แรก) — ไม่งั้น client ต้องยิงรอบสองแค่เพื่อขอลิงก์
 * ซึ่งเป็น round-trip เต็ม ๆ คั่นระหว่างกด "เปิดอ่าน" กับตอนไฟล์เริ่มโหลดจริง
 *
 * ไฟล์ที่เหลือยังขอตั๋วทีละใบตอนสลับเหมือนเดิม — การ์ด 30 ไฟล์จะได้ไม่ต้องออกตั๋วทิ้ง 30 ใบ
 */
async function getMediaCardFiles([cardId, wantFileId], user) {
  const id = parseInt(cardId, 10);
  if (!Number.isInteger(id)) throw new Error('ไม่พบการ์ดนี้');
  const { rows } = await query(
    `SELECT id, visible_levels FROM media_cards WHERE id=$1 AND deleted_at IS NULL`, [id]
  );
  const card = rows[0];
  if (!card) throw new Error('ไม่พบการ์ดนี้');
  await _assertCanSee(card, user);

  const { rows: files } = await query(
    `SELECT id, file_key, file_name, label, file_size
     FROM media_files WHERE card_id=$1 ORDER BY sort_order, id`, [id]
  );

  const want = parseInt(wantFileId, 10);
  const opening = files.find(f => f.id === want) || files[0] || null;
  const url = opening ? await storage.getFileUrl({
    kind: 'media', id: opening.id, key: opening.file_key,
    filename: opening.file_name, user, ttlSeconds: MEDIA_URL_TTL_SECONDS,
  }) : '';

  return { files: files.map(_fileToClient), url, fileId: opening ? opening.id : null };
}

/**
 * ตั๋วเปิดไฟล์ — อายุ 1 ชม. ผูกกับ **ไฟล์ใบเดียว** ไม่ใช่การ์ด
 *
 * ไฟล์ไม่ได้เปิดสาธารณะ แต่ window.open / iframe ไม่ได้แนบ Authorization header ไปด้วย
 * (JWT อยู่ใน localStorage ไม่ใช่ cookie) จึงตรวจสิทธิ์ตอนออกตั๋วผ่าน /api/gas
 * แล้วให้ตัวไฟล์ตรวจแค่ตั๋ว
 *
 * ⚠️ สิทธิ์อยู่ที่การ์ดแม่ ไม่ใช่ที่แถวไฟล์ — ต้อง join กลับทุกครั้ง และต้องเช็ค
 *    `c.deleted_at IS NULL` ด้วย ไม่งั้นไฟล์ของการ์ดที่อยู่ในถังขยะยังเปิดได้
 */
async function getMediaFileTicket([fileId], user) {
  const id = parseInt(fileId, 10);
  if (!Number.isInteger(id)) throw new Error('ไม่พบไฟล์นี้');

  const { rows } = await query(
    `SELECT f.id, f.file_key, f.file_name, c.visible_levels
     FROM media_files f JOIN media_cards c ON c.id = f.card_id
     WHERE f.id=$1 AND c.deleted_at IS NULL`, [id]
  );
  const file = rows[0];
  if (!file) throw new Error('ไม่พบไฟล์นี้');
  await _assertCanSee(file, user);

  const url = await storage.getFileUrl({
    kind: 'media', id, key: file.file_key, filename: file.file_name, user,
    ttlSeconds: MEDIA_URL_TTL_SECONDS,
  });
  return { url };
}

/** โหลดไฟล์พร้อมตรวจว่าคนเรียกแก้การ์ดแม่ได้ — ใช้ร่วมกันทั้งลบและเปลี่ยนชื่อ */
async function _loadOwnedFile(fileId, user) {
  const id = parseInt(fileId, 10);
  if (!Number.isInteger(id)) throw new Error('ไม่พบไฟล์นี้');
  const { rows } = await query(
    `SELECT id, card_id, file_key FROM media_files WHERE id=$1`, [id]
  );
  const file = rows[0];
  if (!file) throw new Error('ไม่พบไฟล์นี้');
  await _loadOwned(file.card_id, user);
  return file;
}

/**
 * ลบไฟล์เดี่ยว — **ลบจริงทันที ไม่มีถังขยะระดับไฟล์**
 *
 * ถังขยะ 30 วันมีที่เดียวคือ `media_cards.deleted_at` (ดู lib/storage/index.js)
 * เพิ่ม deleted_at ที่ตารางไฟล์ = สถานะ 2 ที่ ซึ่งเคยพังมาแล้ว และทำให้ "กู้คืนการ์ด"
 * ต้องตอบว่ากู้ไฟล์ที่ลบแยกด้วยไหม — คำถามที่ไม่มีคำตอบสวย
 *
 * ราคา: ลบผิด = หายเลย · ยอมรับได้เพราะไฟล์ต้นฉบับยังอยู่ในเครื่องครู อัปใหม่ 10 วินาที
 * ต่างจากการ์ดที่มีคำอธิบาย/สิทธิ์/กลุ่มสาระที่พิมพ์มาแล้ว
 */
async function deleteMediaFile([fileId], user) {
  const file = await _loadOwnedFile(fileId, user);
  // ลบ object ก่อนแถวเสมอ — สลับลำดับแล้วลบ object พลาด ไฟล์จะค้างบนที่เก็บตลอดกาล
  await storage.remove(file.file_key);
  await query(`DELETE FROM media_files WHERE id=$1`, [file.id]);
  await query(`UPDATE media_cards SET updated_at=NOW() WHERE id=$1`, [file.card_id]);
  return { status: 'success', message: 'ลบไฟล์แล้ว' };
}

/** ตั้งชื่อที่โชว์ในสารบัญ — ส่งค่าว่างมา = กลับไปใช้ชื่อไฟล์เดิม */
async function renameMediaFile([fileId, label], user) {
  const file = await _loadOwnedFile(fileId, user);
  await query(`UPDATE media_files SET label=$1 WHERE id=$2`, [_str(label, 'label'), file.id]);
  return { status: 'success', message: 'เปลี่ยนชื่อแล้ว' };
}

/**
 * เรียงลำดับใหม่ — รับ id ทั้งชุดมาเรียงแล้ว ไม่ใช่สั่ง "เลื่อนใบนี้ขึ้น"
 * รับทั้งชุดทำให้ตรวจได้ว่า client ถือรายการตรงกับ DB จริง ๆ ไม่ใช่ค้างของเก่าอยู่
 */
async function reorderMediaFiles([cardId, fileIds], user) {
  const card = await _loadOwned(cardId, user);
  const ids = (Array.isArray(fileIds) ? fileIds : [])
    .map(v => parseInt(v, 10)).filter(Number.isInteger);

  const { rows } = await query(`SELECT id FROM media_files WHERE card_id=$1`, [card.id]);
  const own = new Set(rows.map(r => r.id));
  if (ids.length !== own.size || new Set(ids).size !== ids.length
      || !ids.every(i => own.has(i))) {
    throw new Error('ลำดับไฟล์ไม่ตรงกับไฟล์ในการ์ดนี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
  }

  // เขียนทีเดียวด้วย unnest — วนอัปเดตทีละแถวคือ N round-trip
  await query(
    `UPDATE media_files SET sort_order = v.ord
     FROM (SELECT * FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)) v
     WHERE media_files.id = v.id AND media_files.card_id = $2`,
    [ids, card.id]
  );
  await query(`UPDATE media_cards SET updated_at=NOW() WHERE id=$1`, [card.id]);
  return { status: 'success', message: 'เรียงลำดับแล้ว' };
}

// ---------------------------------------------------------------- ถังขยะ / ตัวกวาด

/**
 * soft delete — **ไม่แตะไฟล์เลย** ถังขยะอยู่ที่ `deleted_at` ที่เดียว
 * ไฟล์ถูกลบจริงตอน purgeExpiredCards() หลังพ้น 30 วัน
 * (เคยย้ายไฟล์ตามด้วย ทำให้มีสถานะไม่ตรงกัน 2 ที่ และกู้คืนแล้วได้การ์ดที่เปิดไม่ได้)
 */
async function deleteMediaCard([id], user) {
  const existing = await _loadOwned(id, user);
  await query(`UPDATE media_cards SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL`,
    [existing.id]);

  return { status: 'success', message: 'ลบการ์ดแล้ว กู้คืนได้จากถังขยะ' };
}

async function restoreMediaCard([id], user) {
  const cardId = parseInt(id, 10);
  if (!Number.isInteger(cardId)) throw new Error('ไม่พบการ์ดนี้');
  // ไม่แตะไฟล์ — การ์ดที่พ้น 30 วันถูกลบทั้งแถวไปแล้ว ที่ยังอยู่ในถังขยะจึงมีไฟล์ครบเสมอ
  const { rowCount } = await query(
    `UPDATE media_cards SET deleted_at=NULL, updated_at=NOW()
     WHERE id=$1 AND deleted_at IS NOT NULL`, [cardId]
  );
  if (!rowCount) throw new Error('ไม่พบการ์ดนี้ในถังขยะ');
  return { status: 'success', message: 'กู้คืนการ์ดแล้ว' };
}

async function getDeletedMediaCards(_args, user) {
  const { rows } = await query(
    `SELECT ${SELECT_COLS} ${FROM_CARDS}
     WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC`
  );
  return rows.map(r => _toClient(r, user));
}

// ตัวเลือกของฟอร์ม — ส่งจาก server เพื่อให้ allowlist ที่ validate กับที่ครูเห็นเป็นชุดเดียวกัน
function getMediaCardOptions() {
  return { groups: SUBJECT_GROUPS, levels: LEVELS, icons: ICONS, colors: COLORS,
    groupDefaults: GROUP_DEFAULTS,
    maxUploadMB: MAX_UPLOAD_MB,
    maxFilesPerCard: MAX_FILES_PER_CARD,
    allowedExts: ALLOWED_EXTS,
    allowedLabel: types.labels(ALLOWED_EXTS),
    uploadEnabled: storage.isConfigured() };
}

/**
 * สถานะที่เก็บไฟล์สำหรับ Admin
 * จำนวน/ขนาดมาจาก DB ไม่ใช่ไปไล่ list object — DB รู้อยู่แล้วและถูกกว่ามาก
 */
async function getMediaStorageStatus() {
  const health = await storage.check();
  const { rows } = await query(
    `SELECT count(*)::int AS files,
            COALESCE(sum(f.file_size), 0)::bigint AS usage,
            count(*) FILTER (WHERE c.deleted_at IS NOT NULL)::int AS trashed
     FROM media_files f JOIN media_cards c ON c.id = f.card_id`
  );
  return {
    connected: health.ok,
    driver: storage.driverName(),
    reason: health.ok ? '' : health.detail,
    detail: health.detail,
    files: rows[0].files,
    usage: Number(rows[0].usage),
    // จำนวน **ไฟล์** ที่อยู่ในการ์ดที่ถูกลบ ไม่ใช่จำนวนการ์ด — ตรงกับ usage ที่กินที่อยู่จริง
    trashed: rows[0].trashed,
    quota: quotaBytes(),
  };
}

/**
 * กวาดการ์ดที่ลบเกิน 30 วัน — ลบ object ทุกใบก่อน แล้วค่อยลบแถวการ์ด
 *
 * ลำดับสำคัญ: ลบแถวก่อนแล้ว object ตกค้าง = ไฟล์กำพร้าที่ไม่มีอะไรชี้ถึงตลอดกาล
 * (`ON DELETE CASCADE` ของ media_files เป็นตาข่ายกันแถวกำพร้า **ไม่ใช่ตัวลบไฟล์**)
 * ไฟล์ใบไหนลบไม่สำเร็จ = ข้ามการ์ดนั้นทั้งใบไว้รอบหน้า ดีกว่าปล่อยกำพร้า ·
 * ใบที่ลบไปแล้วในรอบนี้ถูกลบออกจากตารางแล้ว รอบหน้าจึงเดินต่อจากที่ค้าง ไม่ทำซ้ำ
 * เรียกตอน boot ต่อจาก migration — deploy สัปดาห์ละครั้งก็พอกับ policy 30 วัน
 */
async function purgeExpiredCards({ log = console.log } = {}) {
  const { rows } = await query(
    `SELECT id FROM media_cards
     WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${TRASH_DAYS} days'`
  );
  let purged = 0;
  let failed = 0;
  for (const card of rows) {
    const { rows: files } = await query(
      `SELECT id, file_key FROM media_files WHERE card_id=$1`, [card.id]
    );
    let stuck = '';
    for (const f of files) {
      try {
        await storage.remove(f.file_key);
        await query(`DELETE FROM media_files WHERE id=$1`, [f.id]);
      } catch (err) {
        stuck = err.message;
        break;
      }
    }
    if (stuck) {
      failed++;
      log(`[purge] การ์ด ${card.id} ลบไฟล์ไม่สำเร็จ ข้ามไว้รอบหน้า: ${stuck}`);
      continue;
    }
    await query(`DELETE FROM media_cards WHERE id=$1`, [card.id]);
    purged++;
  }
  if (purged || failed) log(`[purge] ลบการ์ดที่หมดอายุ ${purged} ใบ (ข้าม ${failed})`);
  return { purged, failed };
}

module.exports = {
  getMediaCards,
  saveMediaCard,
  addCardFile,
  getMediaCardFiles,
  deleteMediaFile,
  renameMediaFile,
  reorderMediaFiles,
  getMediaStorageStatus,
  getMediaFileTicket,
  purgeExpiredCards,
  deleteMediaCard,
  restoreMediaCard,
  getDeletedMediaCards,
  getMediaCardOptions,
  levelOf,
  quotaBytes,
  SUBJECT_GROUPS, LEVELS, ICONS, COLORS,
  MAX_UPLOAD_MB, MAX_FILES_PER_CARD, ALLOWED_EXTS, TRASH_DAYS, MEDIA_URL_TTL_SECONDS,
};
