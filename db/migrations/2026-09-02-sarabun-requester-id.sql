-- สารบรรณ: เจ้าของเอกสารต้องผูกกับ username ไม่ใช่ชื่อที่แสดง
--
-- เดิม _assertOwnsSarabun เทียบ sarabun.requester (TEXT) กับ users.full_name สด
-- บน production มี 153 แถว ตรงชื่อเป๊ะแค่ 117 — อีก 34 แถวเก็บชื่อย่อ (`ครูพิสิษฐ์`)
-- หรือใส่สองคนในช่องเดียว (`ครูชลวิทย์, ครูศิกษก`) ครูเจ้าของจึงแนบไฟล์เอกสารตัวเองไม่ได้
--
-- requester   = ชื่อที่แสดงเท่านั้น
-- requester_id = เจ้าของจริง (users.username) — เทียบด้วยตัวนี้เสมอเมื่อมีค่า
-- แถวที่ backfill ไม่ตรง (ชื่อย่อ/สองคน/ว่าง) ตั้งใจให้เป็น NULL แล้วตกไปใช้กติกาชื่อเดิม
-- Admin แก้ทะเบียนแล้วเลือกชื่อเต็มให้ถูก = แถวนั้นได้เจ้าของติดไปเอง

ALTER TABLE sarabun ADD COLUMN IF NOT EXISTS requester_id TEXT;

UPDATE sarabun s
   SET requester_id = u.username
  FROM users u
 WHERE s.requester_id IS NULL
   AND trim(coalesce(s.requester, '')) <> ''
   AND trim(u.full_name) = trim(s.requester);
