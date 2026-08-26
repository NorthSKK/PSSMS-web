-- สื่อการสอนเฟส 2 — การ์ดแบบ PDF ที่อัปโหลดขึ้น Google Drive
-- ไฟล์อยู่ใน Drive ส่วนตัวของบัญชีที่เชื่อมต่อไว้ ตารางเก็บแค่ id กับ metadata

ALTER TABLE media_cards ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
ALTER TABLE media_cards ADD COLUMN IF NOT EXISTS file_name     TEXT;
ALTER TABLE media_cards ADD COLUMN IF NOT EXISTS file_size     BIGINT;

-- หาไฟล์กำพร้าตอนสอบสวนปัญหาพื้นที่เต็ม (การ์ดถูกลบแต่ไฟล์ยังอยู่)
CREATE INDEX IF NOT EXISTS idx_media_cards_drive_file
  ON media_cards (drive_file_id) WHERE drive_file_id IS NOT NULL;
