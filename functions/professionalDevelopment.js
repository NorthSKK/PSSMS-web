'use strict';
/** Personal teacher professional-development portfolio. */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool, query } = require('../lib/db');
const storage = require('../lib/storage');
const storageTypes = require('../lib/storage/types');
const license = require('../lib/license');
const { schoolToday } = require('../lib/schoolDate');

const TYPES = ['อบรม', 'สัมมนา', 'ประชุม', 'ไปราชการ', 'ศึกษาดูงาน'];
const STATUSES = ['ร่าง', 'เสร็จสิ้น', 'ยกเลิก'];
const MAX_ATTACH_MB = 25;
const MAX_ATTACHMENTS = 20;
const ATTACH_EXTS = ['pdf', 'jpg', 'png', 'webp', 'docx'];
const UPLOAD_DISABLED_MESSAGE = 'ยังไม่เปิดให้อัปโหลดไฟล์ — แจ้งผู้ดูแลระบบ';
const TRASH_DAYS = 30;
const FILE_TTL = 900;
const idOf = user => String(user?.id || '').trim();
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
function number(v, max) { if (v === '' || v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw new Error('ตัวเลขไม่ถูกต้อง'); return n; }
function activityHours(value, startsAt, endsAt) {
  const supplied = number(value, 9999.99);
  if (supplied !== null || !endsAt) return supplied;
  const hundredths = Math.round((new Date(endsAt) - new Date(startsAt)) / 36000);
  return number(hundredths / 100, 9999.99);
}
function activityId(v) { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new Error('ไม่พบกิจกรรม'); return n; }
function toDate(v, field, required = false) {
  const s = String(v || '').trim();
  if (!s && !required) return null;
  // HTML datetime-local has no offset.  It represents wall-clock time at the
  // school, not the timezone of the Node process (Railway runs in UTC).
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const source = local ? `${s}+07:00` : s;
  const d = new Date(source);
  if (Number.isNaN(d.valueOf())) throw new Error(`${field}ไม่ถูกต้อง`);
  return d.toISOString();
}

async function ownerName(user, db = { query }) {
  const { rows } = await db.query('SELECT full_name FROM users WHERE username=$1', [idOf(user)]);
  return clean(rows[0]?.full_name || user?.name, 160);
}
async function own(id, user, includeDeleted = false, db = { query }, lock = false) {
  const { rows } = await db.query(`SELECT * FROM professional_development_activities
    WHERE id=$1 AND owner_id=$2 ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ${lock ? 'FOR UPDATE' : ''}`, [activityId(id), idOf(user)]);
  if (!rows[0]) throw new Error('ไม่พบกิจกรรมหรือไม่มีสิทธิ์เข้าถึง');
  return rows[0];
}
async function purgeExpired() {
  const { rows } = await query(`SELECT id FROM professional_development_activities
    WHERE deleted_at < NOW() - INTERVAL '${TRASH_DAYS} days' ORDER BY id`);
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const expired = await client.query(`SELECT id FROM professional_development_activities
        WHERE id=$1 AND deleted_at < NOW() - INTERVAL '${TRASH_DAYS} days' FOR UPDATE`, [row.id]);
      if (!expired.rowCount) { await client.query('ROLLBACK'); continue; }
      const files = await client.query('SELECT file_key FROM professional_development_attachments WHERE activity_id=$1 ORDER BY id', [row.id]);
      for (const file of files.rows) await storage.remove(file.file_key);
      await client.query('DELETE FROM professional_development_activities WHERE id=$1', [row.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[professional-development:purge] activity ${row.id}:`, e.message);
    } finally { client.release(); }
  }
}
function row(r) { return { id:r.id, title:r.title, type:r.activity_type, startsAt:r.starts_at, endsAt:r.ends_at, location:r.location, organizer:r.organizer, objective:r.objective, details:r.details, status:r.status, hours:r.hours == null ? null : Number(r.hours), expenses:r.expenses == null ? null : Number(r.expenses), participantCount:Number(r.participant_count || 0), attachmentCount:Number(r.attachment_count || 0), createdAt:r.created_at, updatedAt:r.updated_at, deletedAt:r.deleted_at || null }; }
async function details(activity) {
  const [p, f] = await Promise.all([
    query('SELECT id,participant_kind,reference_id,label,role_label,class_name FROM professional_development_participants WHERE activity_id=$1 ORDER BY id',[activity.id]),
    query('SELECT id,file_name,file_size,created_at FROM professional_development_attachments WHERE activity_id=$1 ORDER BY id',[activity.id]),
  ]);
  return {...row(activity), participants:p.rows.map(x=>({id:x.id,kind:x.participant_kind,referenceId:x.reference_id,label:x.label,role:x.role_label,className:x.class_name})), attachments:f.rows.map(x=>({id:x.id,name:x.file_name,size:Number(x.file_size),createdAt:x.created_at}))};
}
async function replaceParticipants(id, input, db = { query }) {
  const list = Array.isArray(input) ? input.slice(0, 200) : [];
  await db.query('DELETE FROM professional_development_participants WHERE activity_id=$1',[id]);
  const seen = new Set();
  for (const raw of list) {
    const kind = clean(raw?.kind, 16); let ref = clean(raw?.referenceId, 120) || null;
    let label = clean(raw?.label, 160), cls = '', role = clean(raw?.role, 80);
    if (!['teacher','student','external'].includes(kind)) throw new Error('ชนิดผู้ร่วมกิจกรรมไม่ถูกต้อง');
    if (kind === 'external') { if (!label) throw new Error('กรุณาระบุชื่อบุคคลภายนอก'); ref = null; }
    else {
      if (!ref) throw new Error('ผู้ร่วมกิจกรรมในระบบไม่ถูกต้อง');
      const { rows } = await db.query('SELECT username,full_name,role,department FROM users WHERE username=$1',[ref]); const u=rows[0];
      if (!u || (kind === 'teacher' && String(u.role).toUpperCase() !== 'TEACHER') || (kind === 'student' && String(u.role).toUpperCase() !== 'STUDENT')) throw new Error('ไม่พบผู้ร่วมกิจกรรมในระบบ');
      label=clean(u.full_name,160); cls=kind === 'student' ? clean(u.department,80) : '';
    }
    const key=[kind,ref||'',label].join('|'); if (seen.has(key)) continue; seen.add(key);
    await db.query(`INSERT INTO professional_development_participants(activity_id,participant_kind,reference_id,label,role_label,class_name) VALUES($1,$2,$3,$4,$5,$6)`,[id,kind,ref,label,role,cls]);
  }
}
const LIST_SQL = `SELECT a.*,
  (SELECT count(*) FROM professional_development_participants p WHERE p.activity_id=a.id)::int participant_count,
  (SELECT count(*) FROM professional_development_attachments f WHERE f.activity_id=a.id)::int attachment_count
  FROM professional_development_activities a`;
async function getProfessionalDevelopmentActivities(_args, user) { await purgeExpired(); const {rows}=await query(`${LIST_SQL} WHERE a.owner_id=$1 AND a.deleted_at IS NULL ORDER BY a.starts_at DESC,a.id DESC`,[idOf(user)]); return rows.map(row); }
async function getProfessionalDevelopmentActivity([id], user) { await purgeExpired(); return details(await own(id,user)); }
async function saveProfessionalDevelopmentActivity([data], user) {
  await purgeExpired(); const d=data || {}, id=d.id ? activityId(d.id) : null, title=clean(d.title,200), type=clean(d.type,30);
  if (!title) throw new Error('กรุณาระบุชื่อกิจกรรม'); if (!TYPES.includes(type)) throw new Error('ประเภทกิจกรรมไม่ถูกต้อง');
  const starts=toDate(d.startsAt,'วันเริ่ม',true), ends=toDate(d.endsAt,'วันสิ้นสุด'); if (ends && new Date(ends) < new Date(starts)) throw new Error('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
  const values=[title,type,starts,ends,clean(d.location,300),clean(d.organizer,300),clean(d.objective,2000),clean(d.details,6000),STATUSES.includes(d.status)?d.status:'ร่าง',activityHours(d.hours,starts,ends),number(d.expenses,999999999)];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let saved;
    if (id) {
      await own(id,user,false,client,true);
      const r=await client.query(`UPDATE professional_development_activities SET title=$1,activity_type=$2,starts_at=$3,ends_at=$4,location=$5,organizer=$6,objective=$7,details=$8,status=$9,hours=$10,expenses=$11,updated_at=NOW() WHERE id=$12 RETURNING *`,[...values,id]); saved=r.rows[0];
    } else {
      const r=await client.query(`INSERT INTO professional_development_activities(owner_id,owner_name,title,activity_type,starts_at,ends_at,location,organizer,objective,details,status,hours,expenses) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[idOf(user),await ownerName(user,client),...values]); saved=r.rows[0];
    }
    await replaceParticipants(saved.id,d.participants,client);
    await client.query('COMMIT');
    return {status:'success',message:'บันทึกกิจกรรมแล้ว',id:saved.id};
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
async function deleteProfessionalDevelopmentActivity([id], user) { await purgeExpired(); const a=await own(id,user); await query('UPDATE professional_development_activities SET deleted_at=NOW(),updated_at=NOW() WHERE id=$1',[a.id]); return {status:'success',message:'ย้ายไปถังขยะแล้ว กู้คืนได้ภายใน 30 วัน'}; }
async function getDeletedProfessionalDevelopmentActivities(_args,user) { await purgeExpired(); const {rows}=await query(`${LIST_SQL} WHERE a.owner_id=$1 AND a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`,[idOf(user)]); return rows.map(row); }
async function restoreProfessionalDevelopmentActivity([id],user) { const a=await own(id,user,true); if (!a.deleted_at) throw new Error('กิจกรรมนี้ไม่ได้อยู่ในถังขยะ'); const restored=await query(`UPDATE professional_development_activities SET deleted_at=NULL,updated_at=NOW() WHERE id=$1 AND deleted_at >= NOW() - INTERVAL '${TRASH_DAYS} days' RETURNING id`,[a.id]); if(!restored.rowCount) throw new Error('กิจกรรมนี้เลยระยะกู้คืน 30 วันแล้ว'); return {status:'success',message:'กู้คืนกิจกรรมแล้ว'}; }
function getProfessionalDevelopmentOptions() {
  const uploadEnabled = storage.isConfigured();
  return {
    maxUploadMB: MAX_ATTACH_MB,
    maxFilesPerActivity: MAX_ATTACHMENTS,
    allowedExts: ATTACH_EXTS.slice(),
    allowedLabel: storageTypes.labels(ATTACH_EXTS),
    uploadEnabled,
    uploadDisabledReason: uploadEnabled ? '' : UPLOAD_DISABLED_MESSAGE,
  };
}
async function attachProfessionalDevelopmentFile(id,file,user) { const a=await own(id,user); const {rows}=await query('SELECT count(*)::int n FROM professional_development_attachments WHERE activity_id=$1',[a.id]); if(rows[0].n>=MAX_ATTACHMENTS) throw new Error(`แนบได้ไม่เกิน ${MAX_ATTACHMENTS} ไฟล์ต่อกิจกรรม`); const saved=await storage.put({buffer:file.buffer,ext:file.detectedExt}); try { const r=await query('INSERT INTO professional_development_attachments(activity_id,file_key,file_name,file_size) VALUES($1,$2,$3,$4) RETURNING id',[a.id,saved.key,clean(file.originalname,255)||`เอกสาร.${file.detectedExt}`,saved.size]); return {status:'success',message:'แนบไฟล์แล้ว',id:r.rows[0].id}; } catch(e){await storage.remove(saved.key).catch(()=>{});throw e;} }
async function getProfessionalDevelopmentFileTicket([id],user) { const {rows}=await query(`SELECT f.*,a.owner_id,a.deleted_at FROM professional_development_attachments f JOIN professional_development_activities a ON a.id=f.activity_id WHERE f.id=$1 AND a.owner_id=$2 AND a.deleted_at IS NULL`,[activityId(id),idOf(user)]); const f=rows[0];if(!f)throw new Error('ไม่พบไฟล์หรือไม่มีสิทธิ์เข้าถึง');return {url:await storage.getFileUrl({kind:'professional-development',id:f.id,key:f.file_key,filename:f.file_name,user,ttlSeconds:FILE_TTL})}; }
async function deleteProfessionalDevelopmentFile([id],user) { const {rows}=await query(`SELECT f.*,a.owner_id,a.deleted_at FROM professional_development_attachments f JOIN professional_development_activities a ON a.id=f.activity_id WHERE f.id=$1 AND a.owner_id=$2 AND a.deleted_at IS NULL`,[activityId(id),idOf(user)]);const f=rows[0];if(!f)throw new Error('ไม่พบไฟล์หรือไม่มีสิทธิ์เข้าถึง');await storage.remove(f.file_key);await query('DELETE FROM professional_development_attachments WHERE id=$1',[f.id]);return {status:'success',message:'ลบไฟล์แล้ว'}; }
async function getProfessionalDevelopmentPeople([classNames],user) { const classes=Array.isArray(classNames)?classNames.map(x=>clean(x,80)).filter(Boolean).slice(0,30):[]; const [teachers,classRows]=await Promise.all([query("SELECT username,full_name FROM users WHERE UPPER(role)='TEACHER' AND status='ปกติ' ORDER BY full_name"),query("SELECT DISTINCT department FROM users WHERE UPPER(role)='STUDENT' AND status='ปกติ' AND COALESCE(department,'')<>'' ORDER BY department")]); let students=[]; if(classes.length){students=(await query("SELECT username,full_name,department FROM users WHERE UPPER(role)='STUDENT' AND status='ปกติ' AND department=ANY($1::text[]) ORDER BY department,full_name",[classes])).rows;} return {classes:classRows.rows.map(x=>x.department),teachers:teachers.rows.map(x=>({id:x.username,name:x.full_name})),students:students.map(x=>({id:x.username,name:x.full_name,className:x.department}))}; }
function escIcs(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');} function icsDate(iso){return new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');}
async function getProfessionalDevelopmentExport([id],user) { const a=await details(await own(id,user)); const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//PSSMS//Professional Development//TH','BEGIN:VEVENT',`UID:pd-${a.id}@pssms`, `DTSTAMP:${icsDate(new Date().toISOString())}`,`DTSTART:${icsDate(a.startsAt)}`,a.endsAt?`DTEND:${icsDate(a.endsAt)}`:'',`SUMMARY:${escIcs(a.title)}`,`LOCATION:${escIcs(a.location)}`,`DESCRIPTION:${escIcs([a.type,a.organizer,a.objective,a.details].filter(Boolean).join('\\n'))}`,'END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n')+'\r\n'; return {activity:a,ics,formats:{pdf:'print',docx:'document-data'},note:'ใช้ activity เป็นข้อมูลสำหรับหน้า print/PDF และตัวสร้าง DOCX ฝั่ง client; ระบบไม่มีไลบรารีสร้างเอกสารบนเซิร์ฟเวอร์'}; }
async function getProfessionalDevelopmentNotifications(_args,user) { await purgeExpired(); const today=schoolToday(); if (!await license.isLocked()) await query(`INSERT INTO professional_development_notifications(activity_id,owner_id,message)
 SELECT id,owner_id,'กิจกรรม "' || title || '" จบมาแล้ว 2 วัน กรุณาตรวจและบันทึกรายละเอียดให้ครบ'
 FROM professional_development_activities WHERE owner_id=$1 AND deleted_at IS NULL
 AND (status='ร่าง' OR (status='เสร็จสิ้น' AND NULLIF(BTRIM(details),'') IS NULL))
 AND (COALESCE(ends_at,starts_at) AT TIME ZONE 'Asia/Bangkok')::date <= ($2::date - 2)
 ON CONFLICT(activity_id,kind) DO NOTHING`,[idOf(user),today]); const {rows}=await query('SELECT id,activity_id,message,read_at,created_at FROM professional_development_notifications WHERE owner_id=$1 ORDER BY created_at DESC',[idOf(user)]);return rows.map(x=>({id:x.id,activityId:x.activity_id,message:x.message,readAt:x.read_at,createdAt:x.created_at})); }
async function markProfessionalDevelopmentNotificationRead([id],user) { await query('UPDATE professional_development_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND owner_id=$2',[activityId(id),idOf(user)]);return {status:'success'}; }
const PD_DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, type: { type: 'string', enum: TYPES },
    startsAt: { type: ['string', 'null'] }, endsAt: { type: ['string', 'null'] },
    location: { type: 'string' }, organizer: { type: 'string' }, objective: { type: 'string' },
    details: { type: 'string' }, hours: { type: ['number', 'null'] },
    expenses: { type: ['number', 'null'] }, status: { type: 'string', enum: STATUSES },
  },
  required: ['title', 'type', 'startsAt', 'endsAt', 'location', 'organizer', 'objective', 'details', 'hours', 'expenses', 'status'],
};

function scanPrompt() {
  return 'อ่านข้อความและภาพในเอกสาร PDF หรือภาพถ่าย แล้วสร้างร่างกิจกรรมพัฒนาวิชาชีพเป็น JSON ตาม schema เท่านั้น. ' +
    'PDF อาจสแกนเป็นรูป ไม่มี text layer; ภาพถ่ายอาจเอียงหรือมีเงา: ให้อ่านตัวอักษรจากภาพด้วย ไม่ใช่สรุปว่าไม่มีข้อมูลทันที. ' +
    'ห้ามแต่งข้อมูล: ถ้าอ่านไม่ออกหรือไม่พบข้อมูลให้ใช้สตริงว่างหรือ null. ' +
    'วันที่เวลาใช้ ISO 8601 ตามเวลาประเทศไทย (Asia/Bangkok, UTC+7) และใช้ปีคริสต์ศักราช (ค.ศ.) เท่านั้น; ถ้าเอกสารใช้ พ.ศ. ให้ลบ 543 ก่อนตอบ. ' +
    'ประเภทต้องเลือกจาก อบรม, สัมมนา, ประชุม, ไปราชการ, ศึกษาดูงาน; สถานะให้เป็น ร่าง.';
}

function normalizedScanDate(value) {
  if (value == null || String(value).trim() === '') return null;
  const raw = String(value).trim();
  let match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2})[:.](\d{2})(?::(\d{2}))?)?$/.exec(raw);
  let year, month, day, hour, minute, second, offset = '';
  if (match) {
    [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
  } else {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw);
    if (!match) return null;
    [, year, month, day, hour = '00', minute = '00', second = '00', offset = ''] = match;
  }
  year = Number(year);
  if (year >= 2400 && year <= 2999) year -= 543;
  month = Number(month); day = Number(day); hour = Number(hour); minute = Number(minute); second = Number(second);
  if (year < 1 || year > 2399 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const pad = number => String(number).padStart(2, '0');
  if (offset) {
    const isoOffset = offset === 'Z' ? 'Z' : (offset.includes(':') ? offset : `${offset.slice(0, 3)}:${offset.slice(3)}`);
    const instant = new Date(`${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${isoOffset}`);
    if (Number.isNaN(instant.valueOf())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
    const part = type => parts.find(item => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  }
  const calendarCheck = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

function normalizeScanDraft(rawDraft) {
  const draft = { ...rawDraft };
  const warnings = [];
  for (const field of ['startsAt', 'endsAt']) {
    const original = draft[field];
    draft[field] = normalizedScanDate(original);
    if (original != null && String(original).trim() && !draft[field]) warnings.push(`${field === 'startsAt' ? 'วันเวลาเริ่ม' : 'วันเวลาสิ้นสุด'}ที่ AI อ่านได้ไม่ถูกต้อง กรุณาตรวจและกรอกใหม่`);
  }
  if (draft.startsAt && draft.endsAt) {
    const spanMs = Date.parse(`${draft.endsAt}:00Z`) - Date.parse(`${draft.startsAt}:00Z`);
    if (spanMs < 0) {
      draft.endsAt = null;
      warnings.push('วันเวลาสิ้นสุดก่อนวันเวลาเริ่ม ระบบจึงเว้นวันเวลาสิ้นสุดไว้ กรุณาตรวจและกรอกใหม่');
    } else if (spanMs > 366 * 24 * 60 * 60 * 1000) {
      draft.endsAt = null;
      warnings.push('ช่วงเวลากิจกรรมยาวผิดปกติ ระบบจึงเว้นวันเวลาสิ้นสุดไว้ กรุณาตรวจและกรอกใหม่');
    }
  }
  if (draft.hours != null && draft.hours !== '') {
    const hours = Number(draft.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 9999.99) {
      draft.hours = null;
      warnings.push('จำนวนชั่วโมงที่ AI อ่านได้ไม่ถูกต้อง ระบบจึงเว้นไว้ กรุณาตรวจและกรอกใหม่');
    } else {
      draft.hours = hours;
    }
  }
  return { draft, warnings };
}

async function scanWithOpenAI(file, user) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;
  const safeId = crypto.createHash('sha256').update(idOf(user)).digest('hex').slice(0, 32);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: String(process.env.PD_AI_MODEL || 'gpt-5-mini').trim(),
      store: false,
      safety_identifier: safeId,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: scanPrompt() },
        file.type.ext === 'pdf'
          ? { type: 'input_file', filename: /\.pdf$/i.test(clean(file.originalname, 255)) ? clean(file.originalname, 255) : 'document.pdf',
              // Responses expects an inline file as a data URL, not bare base64.
              file_data: `data:application/pdf;base64,${file.buffer.toString('base64')}` }
          : { type: 'input_image', image_url: `data:${file.type.mime};base64,${file.buffer.toString('base64')}` },
      ] }],
      text: { format: { type: 'json_schema', name: 'professional_development_draft', strict: true, schema: PD_DRAFT_SCHEMA } },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI สแกนเอกสารไม่สำเร็จ (${response.status})${body ? ': ' + body.slice(0, 300) : ''}`);
  }
  const result = await response.json();
  // SDKs expose output_text, but raw REST responses may only put it inside the
  // output message content array. Accept both shapes without accepting prose.
  const texts = [result.output_text];
  for (const item of Array.isArray(result.output) ? result.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text') texts.push(content.text);
    }
  }
  const text = texts.find(value => typeof value === 'string' && value.trim()) || '';
  let draft;
  try { draft = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim()); }
  catch {
    const reason = result.incomplete_details?.reason || result.status || 'unknown';
    throw new Error(`OpenAI สแกนเอกสารส่งร่างที่ไม่ใช่ JSON (${reason})`);
  }
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('OpenAI สแกนเอกสารส่งร่างไม่ถูกต้อง');
  return draft;
}

async function scanProfessionalDevelopmentPdf(file,user) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length > 10 * 1024 * 1024) {
    throw new Error('ไฟล์สแกนใหญ่เกิน 10 MB หรืออ่านไฟล์ไม่ได้');
  }
  // Route.receive already sniffs magic bytes; repeat here so callers of the
  // domain function cannot relabel arbitrary bytes as a supported image/PDF.
  const type = storageTypes.detect(file.buffer, ['pdf', 'jpg', 'png', 'webp']);
  if (!type) throw new Error('รองรับเฉพาะไฟล์ PDF / JPEG / PNG / WebP');
  const scannedFile = { ...file, type };
  // โรงเรียนที่มี proxy ของตัวเองยังใช้ต่อได้; หากไม่มีให้ใช้ OpenAI โดยตรงเพื่อไม่ต้อง deploy service เพิ่ม.
  const endpoint = String(process.env.PD_AI_SCAN_URL || '').trim();
  if (!endpoint) {
    const draft = await scanWithOpenAI(scannedFile, user);
    if (draft) return { status: 'success', ...normalizeScanDraft(draft) };
    throw new Error('ยังไม่ได้ตั้งค่า AI สแกนเอกสาร — ใส่ OPENAI_API_KEY หรือ PD_AI_SCAN_URL ใน .env');
  }
  let url; try { url = new URL(endpoint); } catch { throw new Error('PD_AI_SCAN_URL ไม่ถูกต้อง'); }
  if (url.protocol !== 'https:') throw new Error('PD_AI_SCAN_URL ต้องเป็น HTTPS');
  const proxyDocument = { document_base64: file.buffer.toString('base64'), filename: clean(file.originalname,255), requested_by: idOf(user) };
  // Keep the original PDF proxy contract byte-for-byte; image-aware proxies
  // can inspect these additional metadata fields without trusting filenames.
  if (type.ext !== 'pdf') { proxyDocument.mime_type = type.mime; proxyDocument.detected_ext = type.ext; }
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.PD_AI_SCAN_TOKEN ? { authorization: `Bearer ${process.env.PD_AI_SCAN_TOKEN}` } : {}) }, body: JSON.stringify(proxyDocument), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`AI สแกนเอกสารไม่สำเร็จ (${response.status})`);
  const result = await response.json();
  if (!result || typeof result !== 'object') throw new Error('AI สแกนเอกสารส่งผลลัพธ์ไม่ถูกต้อง');
  return { status:'success', ...normalizeScanDraft(result.draft || result) };
}
module.exports={MAX_ATTACH_MB,MAX_ATTACHMENTS,ATTACH_EXTS,UPLOAD_DISABLED_MESSAGE,getProfessionalDevelopmentOptions,getProfessionalDevelopmentActivities,getProfessionalDevelopmentActivity,saveProfessionalDevelopmentActivity,deleteProfessionalDevelopmentActivity,getDeletedProfessionalDevelopmentActivities,restoreProfessionalDevelopmentActivity,attachProfessionalDevelopmentFile,getProfessionalDevelopmentFileTicket,deleteProfessionalDevelopmentFile,getProfessionalDevelopmentPeople,getProfessionalDevelopmentExport,getProfessionalDevelopmentNotifications,markProfessionalDevelopmentNotificationRead,scanProfessionalDevelopmentPdf,purgeExpired};
