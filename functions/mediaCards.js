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
    // คำนวณที่ server — client จะได้ไม่ต้องรู้กติกาสิทธิ์ซ้ำอีกชุด
    canEdit: isAdmin(user) || String(row.created_by || '') === String(user?.id || ''),
  };
}

const SELECT_COLS = `id, title, subject_group, icon, color, meta, description, url,
                     card_type, visible_levels, is_featured, created_by, deleted_at`;

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

function _normalize(payload, user) {
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
    url: _validUrl(p.url),
    levels: _validLevels(p.visibleLevels),
    // ปักหมุดเป็นเครื่องมือจัดหน้ารวมของทั้งโรงเรียน ไม่ใช่ของครูคนเดียว
    isFeatured: isAdmin(user) ? !!p.isFeatured : false,
  };
}

// ครูแก้/ลบได้เฉพาะการ์ดตัวเอง Admin ทำได้หมด — คืนแถวเดิมไว้ให้ผู้เรียกใช้ต่อ
async function _loadOwned(id, user) {
  const cardId = parseInt(id, 10);
  if (!Number.isInteger(cardId)) throw new Error('ไม่พบการ์ดนี้');
  const { rows } = await query(
    `SELECT id, created_by, is_featured, deleted_at FROM media_cards WHERE id=$1`, [cardId]
  );
  const row = rows[0];
  if (!row) throw new Error('ไม่พบการ์ดนี้');
  if (!isAdmin(user) && String(row.created_by || '') !== String(user?.id || '')) {
    throw new Error('แก้ไขได้เฉพาะการ์ดที่ตัวเองเพิ่ม');
  }
  return row;
}

async function saveMediaCard([payload], user) {
  const c = _normalize(payload, user);
  const id = payload && payload.id;

  if (id) {
    const existing = await _loadOwned(id, user);
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

// soft delete — กู้คืนได้จากถังขยะ (Admin) เฟส 2 จะย้ายไฟล์ Drive ลงถังขยะพร้อมกัน
async function deleteMediaCard([id], user) {
  const existing = await _loadOwned(id, user);
  await query(`UPDATE media_cards SET deleted_at=NOW() WHERE id=$1 AND deleted_at IS NULL`,
    [existing.id]);
  return { status: 'success', message: 'ลบการ์ดแล้ว กู้คืนได้จากถังขยะ' };
}

async function restoreMediaCard([id], user) {
  const cardId = parseInt(id, 10);
  if (!Number.isInteger(cardId)) throw new Error('ไม่พบการ์ดนี้');
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
    groupDefaults: GROUP_DEFAULTS };
}

module.exports = {
  getMediaCards,
  saveMediaCard,
  deleteMediaCard,
  restoreMediaCard,
  getDeletedMediaCards,
  getMediaCardOptions,
  levelOf,
  SUBJECT_GROUPS, LEVELS, ICONS, COLORS,
};
