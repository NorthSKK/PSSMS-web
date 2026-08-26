'use strict';
/**
 * Google Drive — ที่เก็บไฟล์ PDF ของสื่อการสอน (และงานสารบรรณในเฟสถัดไป)
 *
 * ใช้ OAuth ของบัญชี Google บัญชีเดียว ไม่ใช่ service account:
 * โรงเรียนไม่มี Google Workspace จึงสร้าง Shared Drive ไม่ได้ และ service account
 * ไม่มีโควตาของตัวเอง อัปโหลดลง My Drive ของใครไม่ได้เลย ไฟล์ทั้งหมดจึงไปอยู่ใน
 * Drive ส่วนตัวของเจ้าของ token (15GB แชร์กับ Gmail และ Google Photos)
 *
 * scope ที่ใช้คือ `drive.file` เท่านั้น — เห็นเฉพาะไฟล์ที่แอปนี้สร้างเอง
 * เป็น scope ที่ Google จัดว่า non-sensitive จึง publish OAuth app เป็น Production
 * ได้โดยไม่ต้องผ่าน verification
 *
 * ⚠️ ถ้าปล่อย OAuth app ไว้โหมด "Testing" refresh token จะหมดอายุใน 7 วัน
 *    แล้วการอัปโหลดจะพังเงียบ ๆ — ต้อง publish เป็น Production ตั้งแต่แรก
 *
 * ออก refresh token ด้วย `node scripts/google-oauth-setup.js`
 */
const { google } = require('googleapis');
const { Readable } = require('stream');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';

function credentials() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
  };
}

function isConfigured() {
  const c = credentials();
  return !!(c.clientId && c.clientSecret && c.refreshToken);
}

// สร้างใหม่ทุกครั้งแทนที่จะ cache ไว้ — googleapis จัดการ refresh access token ให้เอง
// และการ cache client ทำให้เปลี่ยน env แล้วต้อง restart ซึ่งเป็นกับดักตอน debug
function client() {
  const c = credentials();
  if (!isConfigured()) {
    throw new Error('ยังไม่ได้เชื่อมต่อ Google Drive — ตั้ง GOOGLE_OAUTH_* ก่อน');
  }
  const auth = new google.auth.OAuth2(c.clientId, c.clientSecret);
  auth.setCredentials({ refresh_token: c.refreshToken });
  return google.drive({ version: 'v3', auth });
}

// ข้อความ error ของ Google อ่านไม่รู้เรื่องสำหรับครู แปลเฉพาะกรณีที่เจอจริง
// และต้อง "ดัง" เสมอ ห้ามกลืนแล้วรายงานว่าสำเร็จ (บทเรียนจาก uploadSarabunFile เดิม)
function translateError(err) {
  const msg = String((err && err.message) || err || '');
  if (/invalid_grant/i.test(msg)) {
    return new Error('การเชื่อมต่อ Google Drive หมดอายุ — ผู้ดูแลระบบต้องเชื่อมต่อใหม่');
  }
  if (/storageQuotaExceeded|quotaExceeded/i.test(msg)) {
    return new Error('พื้นที่ Google Drive เต็ม — ผู้ดูแลระบบต้องลบไฟล์เก่าหรือเพิ่มพื้นที่');
  }
  if (/insufficient|forbidden|403/i.test(msg)) {
    return new Error('Google Drive ปฏิเสธคำขอ — ตรวจสิทธิ์ของบัญชีที่เชื่อมต่อไว้');
  }
  return new Error('อัปโหลดขึ้น Google Drive ไม่สำเร็จ: ' + msg);
}

/**
 * อัปโหลด PDF แล้วเปิดให้ "ทุกคนที่มีลิงก์" อ่านได้
 *
 * ⚠️ ไฟล์เป็นสาธารณะจริง ๆ ใครได้ลิงก์ไปก็เปิดได้โดยไม่ต้องล็อกอิน
 *    การซ่อนการ์ดจากนักเรียนด้วย visible_levels กันได้แค่ "เห็นในหน้า" ไม่ใช่ access control
 *    (ตัดสินใจแลกกับ bandwidth ของ Railway ไว้แล้ว — ดู CLAUDE.md)
 */
async function uploadPdf({ buffer, filename }) {
  const drive = client();
  const { folderId } = credentials();
  try {
    const { data } = await drive.files.create({
      requestBody: {
        name: filename,
        mimeType: 'application/pdf',
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: { mimeType: 'application/pdf', body: Readable.from(buffer) },
      fields: 'id, name, size, webViewLink',
    });

    await drive.permissions.create({
      fileId: data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    return {
      fileId: data.id,
      name: data.name,
      size: Number(data.size || buffer.length),
      // webViewLink จาก create อาจยังไม่มีตอนไฟล์เพิ่งสร้าง — ประกอบเองไว้เป็นตัวสำรอง
      url: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    };
  } catch (err) {
    throw translateError(err);
  }
}

// ลบการ์ด = ย้ายไฟล์ลงถังขยะ Drive (Google เก็บให้ 30 วันแล้วลบเอง พื้นที่คืนอัตโนมัติ)
async function trashFile(fileId) {
  if (!fileId) return;
  try {
    await client().files.update({ fileId, requestBody: { trashed: true } });
  } catch (err) {
    throw translateError(err);
  }
}

async function untrashFile(fileId) {
  if (!fileId) return;
  try {
    await client().files.update({ fileId, requestBody: { trashed: false } });
  } catch (err) {
    throw translateError(err);
  }
}

// สถานะให้หน้า Admin — ไม่ throw เพราะหน้าต้องแสดง "ขาดการเชื่อมต่อ" ได้ ไม่ใช่พังทั้งหน้า
async function status() {
  if (!isConfigured()) {
    return { connected: false, reason: 'ยังไม่ได้ตั้งค่า GOOGLE_OAUTH_* บนเซิร์ฟเวอร์' };
  }
  try {
    const { data } = await client().about.get({ fields: 'user(emailAddress),storageQuota' });
    const q = data.storageQuota || {};
    const limit = Number(q.limit || 0);
    const usage = Number(q.usage || 0);
    return {
      connected: true,
      email: (data.user && data.user.emailAddress) || '',
      usage,
      limit,
      // limit ว่าง = บัญชีไม่จำกัดพื้นที่ (ไม่ใช่กรณีของบัญชีส่วนตัว แต่กันไว้)
      percent: limit ? Math.round((usage / limit) * 100) : null,
    };
  } catch (err) {
    return { connected: false, reason: translateError(err).message };
  }
}

module.exports = { SCOPE, isConfigured, uploadPdf, trashFile, untrashFile, status, credentials };
