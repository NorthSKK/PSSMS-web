require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const app = express();
app.use(cors());
if (process.env.NODE_ENV !== 'test') app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/assets', require('./routes/assets'));
// multipart — ไม่ผ่าน express.json ข้างบน จึงไม่กระทบ limit ของ endpoint อื่น
app.use('/api/media',  require('./routes/media'));
app.use('/api/gas',    require('./routes/gas'));

/**
 * SPA fallback — คืน index.html ให้ route ของแอป (เช่น /dashboard) ที่ไม่ตรง static ไฟล์ไหน
 *
 * แต่ต้องไม่คืน HTML ให้คำขอที่ขอ "ไฟล์" — เดิม `app.get('*')` ตอบ index.html
 * ให้ทุก path ที่ไม่ match แปลว่า /favicon.ico, /robots.txt, /sitemap.xml ได้ HTML
 * กลับไปพร้อมสถานะ 200 เบราว์เซอร์ที่ขอ favicon เองจึงได้ HTML มาแทนรูป แล้วขึ้นไอคอน
 * เปล่าแทนที่จะถอยไปใช้ <link rel="icon"> ในหน้า (ปัญหานี้เห็นชัดที่สุดบน Safari
 * และแท็บที่ bookmark ไว้)
 *
 * path ที่มีนามสกุลถือว่าเป็นคำขอไฟล์ — ไม่มีไฟล์ก็ต้อง 404 ตามความจริง
 */
app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).type('txt').send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only listen when started directly — tests require this file and bind their own
// ephemeral port instead of racing the dev server on 3000.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // migration ต้องจบก่อนเปิดรับ request — แอปที่ขึ้นมาพร้อมตารางผิดรูปแย่กว่าแอปที่ไม่ขึ้น
  // (เทสต์ require ไฟล์นี้แล้ว listen เอง จึงไม่ผ่านทางนี้ ไม่โดน migrate)
  require('./db/migrate').runMigrations()
    // โรงเรียนใหม่ต้องมีคนล็อกอินเข้าไปตั้งค่าได้ — ทำก่อนอย่างอื่นทั้งหมด
    // ล้มก็ไม่ปิดเซิร์ฟเวอร์ เว็บที่ขึ้นแล้วล็อกอินไม่ได้ยังดีกว่าเว็บที่ไม่ขึ้น
    .then(() => require('./db/bootstrapAdmin').run().catch(err => {
      console.error('[admin]', err.message);
    }))
    // รีเซ็ตรหัส admin ตามคำสั่งจากผู้ขาย (ตั้ง RESET_ADMIN_PASSWORD แล้ว redeploy)
    .then(() => require('./db/resetAdmin').run().catch(err => {
      console.error('[admin]', err.message);
    }))
    .then(() => require('./functions/mediaCards').purgeExpiredCards().catch(err => {
      // กวาดไม่สำเร็จไม่ใช่เหตุให้แอปไม่ขึ้น — รอบหน้าค่อยกวาดใหม่
      console.error('[purge]', err.message);
    }))
    // ตั้งเครื่องเดโมครั้งแรก — ต้องมี DEMO_BOOTSTRAP=1 และ DB ต้องว่างเปล่า
    .then(() => require('./lib/demoBootstrap').run().catch(err => {
      console.error('[demo-bootstrap]', err.message);
    }))
    // เดโมสาธารณะเท่านั้นที่ตัวนี้จะทำงาน — เครื่องโรงเรียนจริงเงียบสนิท
    .then(() => require('./lib/demoReset').start().catch(err => {
      console.error('[demo-reset]', err.message);
    }))
    .then(() => {
      app.listen(PORT, () => {
        console.log(`PSSMS web running → http://localhost:${PORT}`);
      });
    })
    .catch(err => {
      // ⚠️ `err.message` ว่างได้จริง — ต่อ Postgres ไม่ติดแล้วชื่อโฮสต์มีทั้ง IPv6 และ IPv4
      // Node จะโยน AggregateError ที่ message เป็นสตริงว่าง ทำให้ log บอกแค่ว่า
      // "migration ล้มเหลว" เฉย ๆ แล้วไล่ต่อไม่ได้เลยว่าเพราะอะไร (เจอตอนตั้งโรงเรียนใหม่
      // แล้ว DATABASE_URL ว่าง) — ต้องกาง `.errors` ออกมาเอง
      const detail = err.message
        || (Array.isArray(err.errors) && err.errors.map(e => e.message).filter(Boolean).join(' · '))
        || err.code || String(err);
      let target = '(ไม่ได้ตั้ง DATABASE_URL)';
      if (process.env.DATABASE_URL) {
        // host อย่างเดียว ไม่เอา user/password ติดไปใน log
        try { target = new URL(process.env.DATABASE_URL).host; }
        catch { target = '(DATABASE_URL อ่านไม่ออก)'; }
      }
      console.error(`[boot] migration ล้มเหลว ไม่เปิดเซิร์ฟเวอร์: ${detail} · ปลายทาง ${target}`);
      process.exit(1);
    });
}

module.exports = app;
