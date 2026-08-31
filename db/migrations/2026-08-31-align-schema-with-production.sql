-- schema.sql เพี้ยนจากฐานข้อมูลที่ใช้งานจริงมานาน — โรงเรียนที่ deploy ใหม่จะได้ระบบที่ขาดของ
--
-- เจอตอนตั้งเครื่องเดโม: seed ล้มด้วย invalid input syntax for type numeric: "-"
-- เพราะ schema.sql ประกาศ score เป็น NUMERIC ทั้งที่ ปพ.5 ต้องเก็บ 'ร' 'มส' '-'
-- ไล่เทียบทั้งฐานแล้วพบว่าขาดมากกว่านั้น: ตาราง savings_transactions หายทั้งตาราง
-- และ qualitative_assess ขาด 14 คอลัมน์ที่หน้า ปพ.5 อ่าน
--
-- ไฟล์นี้เป็น no-op สำหรับโรงเรียนที่ใช้งานอยู่แล้ว (มีของพวกนี้ครบ)
-- มีผลจริงเฉพาะฐานข้อมูลที่ถูกสร้างจาก schema.sql ตัวเก่า

-- คะแนนเป็นข้อความ ไม่ใช่ตัวเลข
ALTER TABLE score_database ALTER COLUMN score     TYPE TEXT USING score::TEXT;
ALTER TABLE score_history  ALTER COLUMN old_score TYPE TEXT USING old_score::TEXT;
ALTER TABLE score_history  ALTER COLUMN new_score TYPE TEXT USING new_score::TEXT;

-- คุณลักษณะอันพึงประสงค์ / อ่านคิดวิเคราะห์
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS char1      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS char2      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS char3      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS char4      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS char_total INTEGER DEFAULT 0;
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS char_grade INTEGER DEFAULT 0;
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS read1      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS read2      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS read3      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS read4      TEXT    DEFAULT '';
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS read_total INTEGER DEFAULT 0;
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS read_grade INTEGER DEFAULT 0;
ALTER TABLE qualitative_assess ADD COLUMN IF NOT EXISTS comp       INTEGER DEFAULT 3;

ALTER TABLE budgets        ADD COLUMN IF NOT EXISTS created_by           TEXT DEFAULT '';
ALTER TABLE subject_config ADD COLUMN IF NOT EXISTS exam_indicators_json JSONB;

-- ระบบเงินออม
CREATE TABLE IF NOT EXISTS savings_transactions (
  id            SERIAL PRIMARY KEY,
  student_id    TEXT NOT NULL,
  student_name  TEXT NOT NULL,
  class         TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL CHECK (type IN ('deposit','withdraw')),
  amount        NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  recorded_by   TEXT NOT NULL,
  note          TEXT DEFAULT '',
  date          DATE NOT NULL,
  term          TEXT NOT NULL,
  year          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_savings_student    ON savings_transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_savings_class_term ON savings_transactions(class, term, year);
CREATE INDEX IF NOT EXISTS idx_savings_date       ON savings_transactions(date);
