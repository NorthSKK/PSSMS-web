-- ไฟล์แนบงานสารบรรณ — เก็บ key ในที่เก็บไฟล์ (lib/storage/) แบบเดียวกับ media_cards
--
-- คอลัมน์ file_url เดิมเก็บไว้เฉย ๆ ไม่ใช้แล้ว: uploadSarabunFile เป็น stub มาตลอด
-- จึงควรว่างทั้งตาราง ลบทิ้งได้เมื่อยืนยันว่าไม่มีข้อมูล

ALTER TABLE sarabun ADD COLUMN IF NOT EXISTS file_key  TEXT;
ALTER TABLE sarabun ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE sarabun ADD COLUMN IF NOT EXISTS file_size BIGINT;

CREATE INDEX IF NOT EXISTS idx_sarabun_file_key
  ON sarabun (file_key) WHERE file_key IS NOT NULL;
