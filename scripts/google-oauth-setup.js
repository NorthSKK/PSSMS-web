#!/usr/bin/env node
'use strict';
/**
 * ออก refresh token ของ Google Drive สำหรับฟีเจอร์อัปโหลด PDF (สื่อการสอน)
 *
 * รันในเครื่องตัวเอง ครั้งเดียว แล้วเอา token ที่ได้ไปใส่เป็น env var บน Railway
 *
 *   GOOGLE_OAUTH_CLIENT_ID=xxx GOOGLE_OAUTH_CLIENT_SECRET=yyy node scripts/google-oauth-setup.js
 *
 * ต้องสร้าง OAuth client ชนิด "Desktop app" ใน Google Cloud Console ก่อน
 * (ชนิดนี้ยอมรับ redirect เป็น http://localhost พอร์ตอะไรก็ได้ ไม่ต้องลงทะเบียนพอร์ต)
 *
 * ⚠️ ต้อง publish OAuth consent screen เป็น "In production" ก่อนรัน
 *    ถ้ายังเป็น "Testing" refresh token ที่ได้จะหมดอายุใน 7 วัน แล้วระบบพังเงียบ ๆ
 *    scope ที่ขอคือ drive.file ซึ่ง Google จัดเป็น non-sensitive จึง publish ได้เลย
 *    โดยไม่ต้องส่ง verification
 */
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ ต้องส่ง GOOGLE_OAUTH_CLIENT_ID และ GOOGLE_OAUTH_CLIENT_SECRET มาด้วย');
  console.error('   ดูวิธีสร้างที่ WEB_DEV.md หัวข้อ "เชื่อมต่อ Google Drive"');
  process.exit(1);
}

const server = http.createServer();
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const redirectUri = `http://localhost:${port}`;
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);

  const url = auth.generateAuthUrl({
    access_type: 'offline',      // ต้องมี ไม่งั้นไม่ได้ refresh token
    prompt: 'consent',           // บังคับถามใหม่ เพื่อให้ได้ refresh token ทุกครั้งที่รันซ้ำ
    scope: [SCOPE],
  });

  console.log('\nเปิดลิงก์นี้ในเบราว์เซอร์ แล้วล็อกอินด้วยบัญชี Google ที่จะใช้เก็บไฟล์:\n');
  console.log(url + '\n');
  console.log(`(รอ callback ที่ ${redirectUri} — กด Ctrl+C เพื่อยกเลิก)\n`);

  server.on('request', async (req, res) => {
    const query = new URL(req.url, redirectUri).searchParams;
    const code = query.get('code');
    const error = query.get('error');

    const reply = (msg) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">${msg}</body>`);
    };

    if (error) {
      reply('❌ ปฏิเสธการเชื่อมต่อ — กลับไปที่ terminal');
      console.error('❌ ผู้ใช้ปฏิเสธ:', error);
      server.close(() => process.exit(1));
      return;
    }
    if (!code) return reply('รอ code จาก Google...');

    try {
      const { tokens } = await auth.getToken(code);
      if (!tokens.refresh_token) {
        reply('⚠️ ไม่ได้ refresh token — กลับไปที่ terminal');
        console.error('\n❌ Google ไม่ส่ง refresh token กลับมา');
        console.error('   เกิดเมื่อบัญชีนี้เคยอนุญาตแอปนี้ไปแล้ว — ถอนสิทธิ์ที่');
        console.error('   https://myaccount.google.com/permissions แล้วรันใหม่');
        server.close(() => process.exit(1));
        return;
      }

      reply('✅ เชื่อมต่อสำเร็จ — กลับไปที่ terminal เพื่อคัดลอก token');
      console.log('\n✅ ได้ refresh token แล้ว ตั้งค่าพวกนี้บน Railway:\n');
      console.log(`GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`);
      console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);

      // สร้างโฟลเดอร์ให้เลย จะได้ไม่ไปกองปนกับไฟล์ส่วนตัวใน My Drive
      try {
        const drive = google.drive({ version: 'v3', auth });
        const { data } = await drive.files.create({
          requestBody: { name: 'PSSMS สื่อการสอน', mimeType: 'application/vnd.google-apps.folder' },
          fields: 'id',
        });
        console.log(`GOOGLE_DRIVE_FOLDER_ID=${data.id}`);
        console.log('\n(สร้างโฟลเดอร์ "PSSMS สื่อการสอน" ใน Drive ให้แล้ว)');
      } catch (e) {
        console.log('\n⚠️ สร้างโฟลเดอร์ไม่สำเร็จ:', e.message);
        console.log('   ข้าม GOOGLE_DRIVE_FOLDER_ID ได้ ไฟล์จะไปอยู่ที่ราก My Drive แทน');
      }

      console.log('\n⚠️ อย่า commit ค่าพวกนี้ลง git\n');
      server.close(() => process.exit(0));
    } catch (e) {
      reply('❌ แลก code เป็น token ไม่สำเร็จ — กลับไปที่ terminal');
      console.error('\n❌ แลก token ไม่สำเร็จ:', e.message);
      server.close(() => process.exit(1));
    }
  });
});
