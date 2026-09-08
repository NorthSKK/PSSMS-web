-- คลังตัวชี้วัด: unique (subject_code, standard_code)
--
-- ⚠️ constraint ตัวนี้เคยมีเฉพาะใน DB ของโรงเรียนแรก — ถูกสร้างด้วยมือตอน migrate
-- จาก Sheets แล้วไม่เคยเข้า repo ทั้งใน schema.sql และ migrations
-- โรงเรียนใหม่ที่สร้าง DB จาก schema.sql จึงไม่มี แล้วทุก `ON CONFLICT
-- (subject_code, standard_code)` ล้มด้วย "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" — พัง 3 ทาง:
--   saveSubjectConfig (auto-add) · addCurriculumItem · importCurriculumCSV
-- หนักสุดคือตัวแรก: subject_config ถูกเขียนสำเร็จไปแล้วค่อย throw ตอน auto-add
-- ครูจึงเห็น error ทั้งที่โครงสร้างวิชาบันทึกไปแล้ว แล้วกดซ้ำ

-- ลบซ้ำก่อน เก็บ id ต่ำสุดของแต่ละคู่ (DB ที่ไม่มี constraint อาจสะสมซ้ำไว้)
DELETE FROM curriculum a USING curriculum b
 WHERE a.id > b.id
   AND coalesce(a.subject_code,'')  = coalesce(b.subject_code,'')
   AND coalesce(a.standard_code,'') = coalesce(b.standard_code,'');

CREATE UNIQUE INDEX IF NOT EXISTS curriculum_subject_standard_unique
  ON curriculum (subject_code, standard_code);
