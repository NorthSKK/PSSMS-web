-- สื่อการสอน: ให้ครูเพิ่มการ์ดเองได้ (เฟส 1 — การ์ดแบบลิงก์)
-- card_type/pdf มีไว้ล่วงหน้าสำหรับเฟส 2 (อัปโหลด PDF ขึ้น Drive) เฟส 1 ใช้ 'link' อย่างเดียว

CREATE TABLE IF NOT EXISTS media_cards (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  subject_group  TEXT NOT NULL DEFAULT '',
  icon           TEXT NOT NULL DEFAULT 'fa-book-open-reader',
  color          TEXT NOT NULL DEFAULT '#00897b',
  meta           TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  card_type      TEXT NOT NULL DEFAULT 'link' CHECK (card_type IN ('link', 'pdf')),
  visible_levels TEXT[] NOT NULL DEFAULT '{}',
  is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_media_cards_live
  ON media_cards (is_featured DESC, created_at DESC) WHERE deleted_at IS NULL;

-- ย้ายการ์ดที่เคย hardcode ใน MEDIA_SUBJECTS (Scripts_General.html) เข้า DB
-- ปักหมุดไว้บนสุด และเปิดให้ทุกระดับชั้นเห็น เพราะเดิมนักเรียนก็เห็นอยู่แล้ว
INSERT INTO media_cards (title, subject_group, icon, color, meta, description, url, visible_levels, is_featured, created_by)
SELECT * FROM (VALUES
  ('สุขศึกษาและพลศึกษา ม.2', 'สุขศึกษาและพลศึกษา', 'fa-heart-pulse', '#00897b',
   '14 หน่วยการเรียนรู้',
   'เนื้อหาครบทุกหน่วยตามตัวชี้วัด พร้อมแบบทดสอบท้ายหน่วย โหมดนำเสนอ และแผนการสอน',
   'https://health-m2.vercel.app',
   ARRAY['ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'], TRUE, ''),
  ('ป้องกันทุจริตศึกษา', 'สังคมศึกษา ศาสนา และวัฒนธรรม', 'fa-scale-balanced', '#8a3324',
   '34 บทเรียน',
   'สรุปรัฐธรรมนูญ 2560 และประมวลกฎหมายอาญา พร้อมเควิซท้ายบท',
   'https://thai-law-learning.vercel.app',
   ARRAY['ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'], TRUE, '')
) AS seed(title, subject_group, icon, color, meta, description, url, visible_levels, is_featured, created_by)
WHERE NOT EXISTS (SELECT 1 FROM media_cards);
