'use strict';
/**
 * สื่อการสอน — การ์ดที่ครูเพิ่มเองได้บนหน้า Page_Teaching_Media
 *
 * กติกาการมองเห็น (สำคัญ — เป็นจุดที่บั๊กแล้วเงียบที่สุดของฟีเจอร์นี้):
 *   - ครูและ Admin เห็นทุกใบเสมอ
 *   - นักเรียนเห็นเฉพาะใบที่ระดับชั้นตัวเองอยู่ใน visible_levels
 *   - visible_levels ว่าง = ครูเท่านั้น (ค่า default ตอนสร้างการ์ด) — กันเฉลย/ข้อสอบหลุด
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

const MAX = { title: 120, meta: 60, description: 300, url: 2000 };

// 25MB ต่อไฟล์ — สื่อการสอนสแกนทั้งเล่มใหญ่กว่านี้ ควรบีบอัดก่อน และโควตารวมมีแค่ 15GB
const MAX_UPLOAD_MB = 25;

// ถังขยะ — ลบแล้วกู้คืนได้กี่วันก่อนหายถาวร (ทั้งแถวและไฟล์)
const TRASH_DAYS = 30;

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
    fileName: row.file_name || '',
    fileSize: row.file_size == null ? null : Number(row.file_size),
    // คำนวณที่ server — client จะได้ไม่ต้องรู้กติกาสิทธิ์ซ้ำอีกชุด
    canEdit: isAdmin(user) || String(row.created_by || '') === String(user?.id || ''),
  };
}

const SELECT_COLS = `id, title, subject_group, icon, color, meta, description, url,
                     card_type, visible_levels, is_featured, created_by, deleted_at,
                     file_key, file_name, file_size`;

async function getMediaCards(_args, user) {
  if (_isStaff(user)) {
    const { rows } = await query(
      `SELECT ${SELECT_COLS} FROM media_cards
       WHERE deleted_at IS NULL
       ORDER BY is_featured DESC, created_at DESC, id DESC`
    );
    return rows.map(r => _toClient(r, user));
  }

  const level = await _studentLevel(user);
  if (!level) return [];
  const { rows } = await query(
    `SELECT ${SELECT_COLS} FROM media_cards
     WHERE deleted_at IS NULL AND $1 = ANY(visible_levels)
     ORDER BY is_featured DESC, created_at DESC, id DESC`,
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

// การ์ด PDF ไม่มี url จากครู (url มาจาก Drive) จึงแยกส่วนที่ใช้ร่วมกันออกมา
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
    `SELECT id, created_by, is_featured, deleted_at, card_type, url, file_key
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
    // การ์ด PDF ชี้ไปที่ไฟล์ใน Drive — url แก้จากฟอร์มไม่ได้ ไม่งั้นชี้ไปไหนก็ได้
    // ทั้งที่ยังนับเป็นไฟล์ของเรา (เปลี่ยนไฟล์ = ลบการ์ดแล้วอัปใหม่)
    const c = existing.card_type === 'pdf'
      ? { ..._normalizeMeta(payload, user), url: existing.url }
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

  const c = _normalize(payload, user);
  const { rows } = await query(
    `INSERT INTO media_cards
       (title, subject_group, icon, color, meta, description, url, card_type,
        visible_levels, is_featured, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'link',$8,$9,$10)
     RETURNING id`,
    [c.title, c.group, c.icon, c.color, c.meta, c.desc, c.url, c.levels, c.isFeatured,
     String(user?.id || '')]
  );
  return { status: 'success', id: rows[0].id, message: 'เพิ่มการ์ดเรียบร้อย' };
}

/**
 * การ์ดแบบ PDF — เรียกจาก routes/media.js เท่านั้น (multipart ไม่ผ่าน /api/gas)
 *
 * ตรวจ metadata ให้ครบ *ก่อน* อัปขึ้น Drive เสมอ ไม่งั้นชื่อสื่อว่างจะทำให้ไฟล์
 * ขึ้นไปกองอยู่บน Drive โดยไม่มีแถวในตารางชี้ถึง = ไฟล์กำพร้าที่กินโควตาเงียบ ๆ
 */
async function createPdfCard({ payload, file }, user) {
  const c = _normalizeMeta(payload, user);
  if (!file || !file.buffer || !file.buffer.length) throw new Error('ไม่พบไฟล์ที่อัปโหลด');

  const saved = await storage.put({ buffer: file.buffer, ext: file.detectedExt });

  try {
    // url ว่างไว้ก่อน — ต้องรู้ id ของแถวก่อนถึงจะประกอบลิงก์ได้ (ลิงก์อ้าง id ไม่ใช่ file_key
    // เพื่อให้ตอนเสิร์ฟไฟล์ตรวจสิทธิ์จากการ์ดใบนั้นได้ตรง ๆ)
    const { rows } = await query(
      `INSERT INTO media_cards
         (title, subject_group, icon, color, meta, description, url, card_type,
          visible_levels, is_featured, created_by, file_key, file_name, file_size)
       VALUES ($1,$2,$3,$4,$5,$6,'','pdf',$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [c.title, c.group, c.icon, c.color, c.meta || _sizeLabel(saved.size), c.desc,
       c.levels, c.isFeatured, String(user?.id || ''),
       saved.key, file.originalname || saved.name, saved.size]
    );
    return { status: 'success', id: rows[0].id, message: 'อัปโหลดและเพิ่มการ์ดเรียบร้อย' };
  } catch (err) {
    // เขียนตารางไม่สำเร็จหลังไฟล์ขึ้นที่เก็บแล้ว — เก็บกวาดทิ้ง อย่าปล่อยไฟล์กำพร้ากินพื้นที่
    await storage.remove(saved.key).catch(() => {});
    throw err;
  }
}

function _sizeLabel(bytes) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  return mb >= 1 ? `PDF · ${mb.toFixed(1)} MB` : `PDF · ${Math.max(1, Math.round(bytes / 1024))} KB`;
}

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
    `SELECT ${SELECT_COLS} FROM media_cards
     WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
  );
  return rows.map(r => _toClient(r, user));
}

// ตัวเลือกของฟอร์ม — ส่งจาก server เพื่อให้ allowlist ที่ validate กับที่ครูเห็นเป็นชุดเดียวกัน
function getMediaCardOptions() {
  return { groups: SUBJECT_GROUPS, levels: LEVELS, icons: ICONS, colors: COLORS,
    groupDefaults: GROUP_DEFAULTS,
    maxUploadMB: MAX_UPLOAD_MB,
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
            COALESCE(sum(file_size), 0)::bigint AS usage,
            count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trashed
     FROM media_cards WHERE file_key IS NOT NULL`
  );
  return {
    connected: health.ok,
    driver: storage.driverName(),
    reason: health.ok ? '' : health.detail,
    detail: health.detail,
    files: rows[0].files,
    usage: Number(rows[0].usage),
    trashed: rows[0].trashed,
  };
}

/**
 * กวาดการ์ดที่ลบเกิน 30 วัน — ลบ object ก่อน แล้วค่อยลบแถว
 *
 * ลำดับสำคัญ: ลบแถวก่อนแล้ว object ตกค้าง = ไฟล์กำพร้าที่ไม่มีอะไรชี้ถึงตลอดกาล
 * ลบ object ไม่สำเร็จ = ข้ามใบนั้นไว้ให้รอบหน้า ดีกว่าปล่อยกำพร้า
 * เรียกตอน boot ต่อจาก migration — deploy สัปดาห์ละครั้งก็พอกับ policy 30 วัน
 */
async function purgeExpiredCards({ log = console.log } = {}) {
  const { rows } = await query(
    `SELECT id, file_key FROM media_cards
     WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${TRASH_DAYS} days'`
  );
  let purged = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (row.file_key) await storage.remove(row.file_key);
      await query(`DELETE FROM media_cards WHERE id=$1`, [row.id]);
      purged++;
    } catch (err) {
      failed++;
      log(`[purge] การ์ด ${row.id} ลบไฟล์ไม่สำเร็จ ข้ามไว้รอบหน้า: ${err.message}`);
    }
  }
  if (purged || failed) log(`[purge] ลบการ์ดที่หมดอายุ ${purged} ใบ (ข้าม ${failed})`);
  return { purged, failed };
}

/**
 * ตั๋วเปิดไฟล์ — อายุสั้น ผูกกับการ์ดใบเดียว
 *
 * ไฟล์ไม่ได้เปิดสาธารณะ แต่ window.open ไม่ได้แนบ Authorization header ไปด้วย
 * (JWT อยู่ใน localStorage ไม่ใช่ cookie) จึงตรวจสิทธิ์ตอนออกตั๋วผ่าน /api/gas
 * แล้วให้ตัวไฟล์ตรวจแค่ตั๋ว — ตั๋วอยู่ใน query string จึงต้องอายุสั้น
 */
async function getMediaFileTicket([cardId], user) {
  const id = parseInt(cardId, 10);
  if (!Number.isInteger(id)) throw new Error('ไม่พบการ์ดนี้');

  const { rows } = await query(
    `SELECT id, card_type, file_key, file_name, visible_levels FROM media_cards
     WHERE id=$1 AND deleted_at IS NULL`, [id]
  );
  const card = rows[0];
  if (!card || card.card_type !== 'pdf' || !card.file_key) throw new Error('ไม่พบไฟล์ของการ์ดนี้');

  if (!_isStaff(user)) {
    const level = await _studentLevel(user);
    if (!level || !(card.visible_levels || []).includes(level)) {
      throw new Error('ไม่มีสิทธิ์เปิดไฟล์นี้');
    }
  }

  const url = await storage.getFileUrl({
    kind: 'media', id, key: card.file_key, filename: card.file_name, user,
  });
  return { url };
}

module.exports = {
  getMediaCards,
  saveMediaCard,
  createPdfCard,
  getMediaStorageStatus,
  getMediaFileTicket,
  purgeExpiredCards,
  deleteMediaCard,
  restoreMediaCard,
  getDeletedMediaCards,
  getMediaCardOptions,
  levelOf,
  SUBJECT_GROUPS, LEVELS, ICONS, COLORS, MAX_UPLOAD_MB, TRASH_DAYS,
};
