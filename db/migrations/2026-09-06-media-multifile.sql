-- สื่อการสอน: การ์ดใบเดียวถือได้หลายไฟล์ (โหมดอ่านแบบ ebook)
--
-- เดิม 1 การ์ด = 1 ไฟล์ เก็บใน media_cards.file_key/file_name/file_size
-- ครูที่มีสื่อเป็นชุด (หนังสือ 14 บท, ใบงานสแกน 30 หน้า) ต้องสร้าง 30 การ์ด
-- หน้ารวมเละ และคนอ่านต้องเด้งแท็บใหม่ทุกครั้งที่เปลี่ยนไฟล์
--
-- ไฟล์ย้ายไปตารางแยก ไม่ใช่คอลัมน์ JSONB เพราะ purgeExpiredCards กับ
-- getMediaStorageStatus ยืนบน file_key / sum(file_size) ที่เป็นคอลัมน์จริง
-- และการเพิ่ม/ลบทีละใบบน JSONB คือ read-modify-write ทั้ง array
-- ซึ่งอัปหลายไฟล์พร้อมกันแล้วทับกันหาย
--
-- card_type 'pdf' → 'files' เพราะรับรูป (jpg/png) ด้วยแล้ว ชื่อเดิมโกหก
-- ตอน migrate ยังไม่มีการ์ดไฟล์จริงบน production จึงย้ายแล้ว drop คอลัมน์เก่าได้ในไฟล์เดียว
-- (เหลือ 2 ที่ = โค้ดต้องมีสาขา if ว่าอ่านจากไหน ซึ่งเป็นบั๊กที่เงียบที่สุด)

CREATE TABLE IF NOT EXISTS media_files (
  id         SERIAL PRIMARY KEY,
  -- CASCADE เป็น **ตาข่ายกันแถวกำพร้า ไม่ใช่ตัวลบไฟล์** — ต้องลบ object บนที่เก็บก่อนเสมอ
  -- ไม่งั้น cascade กินแถวไปแล้วไฟล์ค้างตลอดกาลโดยไม่มีอะไรชี้ถึง (ดู purgeExpiredCards)
  card_id    INTEGER NOT NULL REFERENCES media_cards(id) ON DELETE CASCADE,
  file_key   TEXT NOT NULL,
  file_name  TEXT NOT NULL DEFAULT '',   -- ชื่อไฟล์เดิมที่ครูอัปมา
  label      TEXT NOT NULL DEFAULT '',   -- ชื่อในสารบัญ · ว่าง = ใช้ file_name
  file_size  BIGINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_files_card ON media_files (card_id, sort_order, id);
-- หาไฟล์กำพร้าตอนสอบสวนปัญหาพื้นที่เต็ม (แถวถูกลบแต่ object ยังอยู่)
CREATE INDEX IF NOT EXISTS idx_media_files_key  ON media_files (file_key);

-- ย้ายไฟล์เดิมเข้าตารางใหม่ — no-op บน production ปัจจุบัน (ยังไม่มีการ์ดไฟล์จริง)
INSERT INTO media_files (card_id, file_key, file_name, label, file_size, sort_order)
SELECT id, file_key, COALESCE(file_name, ''), COALESCE(file_name, ''),
       COALESCE(file_size, 0), 0
FROM media_cards
WHERE file_key IS NOT NULL;

UPDATE media_cards SET card_type = 'files' WHERE card_type = 'pdf';

-- CHECK เดิมไม่ได้ตั้งชื่อไว้ Postgres จึงตั้งให้เอง — หาจากนิยามไม่ใช่จากชื่อ
-- เผื่อ DB ไหนเคยถูกแก้ด้วยมือแล้วชื่อไม่ตรงกับที่ schema.sql คาด
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'media_cards'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%card_type%'
  LOOP
    EXECUTE format('ALTER TABLE media_cards DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE media_cards
  ADD CONSTRAINT media_cards_card_type_check CHECK (card_type IN ('link', 'files'));

DROP INDEX IF EXISTS idx_media_cards_file_key;

ALTER TABLE media_cards
  DROP COLUMN IF EXISTS file_key,
  DROP COLUMN IF EXISTS file_name,
  DROP COLUMN IF EXISTS file_size;
