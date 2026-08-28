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

// SPA fallback — serves index.html for any unmatched path
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only listen when started directly — tests require this file and bind their own
// ephemeral port instead of racing the dev server on 3000.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // migration ต้องจบก่อนเปิดรับ request — แอปที่ขึ้นมาพร้อมตารางผิดรูปแย่กว่าแอปที่ไม่ขึ้น
  // (เทสต์ require ไฟล์นี้แล้ว listen เอง จึงไม่ผ่านทางนี้ ไม่โดน migrate)
  require('./db/migrate').runMigrations()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`PSSMS web running → http://localhost:${PORT}`);
      });
    })
    .catch(err => {
      console.error('[boot] migration ล้มเหลว ไม่เปิดเซิร์ฟเวอร์:', err.message);
      process.exit(1);
    });
}

module.exports = app;
