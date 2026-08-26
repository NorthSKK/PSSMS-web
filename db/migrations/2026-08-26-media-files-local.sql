-- สื่อการสอน: ย้ายที่เก็บ PDF จาก Google Drive มาเป็นดิสก์ (Railway Volume)
--
-- เหตุผล: publish OAuth consent screen เป็น production ต้องยืนยันความเป็นเจ้าของโดเมน
-- แต่ *.up.railway.app เป็นของ Railway ไม่ใช่ของโรงเรียน จึงเพิ่มเป็น Authorized domain ไม่ได้
-- และถ้าค้างโหมด Testing ไว้ refresh token จะหมดอายุทุก 7 วัน
--
-- drive_file_id → file_key: เก็บชื่อไฟล์บนดิสก์แทน id ของ Drive
-- ตอน migrate ยังไม่มีการ์ด PDF จริงบน production จึงเปลี่ยนชื่อคอลัมน์ตรง ๆ ได้

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'media_cards' AND column_name = 'drive_file_id') THEN
    ALTER TABLE media_cards RENAME COLUMN drive_file_id TO file_key;
  END IF;
END $$;

ALTER TABLE media_cards ADD COLUMN IF NOT EXISTS file_key TEXT;

DROP INDEX IF EXISTS idx_media_cards_drive_file;
CREATE INDEX IF NOT EXISTS idx_media_cards_file_key
  ON media_cards (file_key) WHERE file_key IS NOT NULL;
