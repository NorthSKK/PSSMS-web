ALTER TABLE users ADD COLUMN IF NOT EXISTS student_no INTEGER
  CONSTRAINT users_student_no_positive CHECK (student_no > 0);
CREATE UNIQUE INDEX IF NOT EXISTS users_student_no_unique
  ON users (BTRIM(year), (regexp_replace(lower(department), '[^a-zA-Z0-9ก-๙]', '', 'g')), student_no)
  WHERE UPPER(role)='STUDENT' AND student_no IS NOT NULL;

-- ลำดับเดิมของ ปพ.5 คือเรียงรหัสแบบข้อความ เติมครั้งเดียวและเก็บไว้ให้คงที่.
-- จำนวนผู้เรียนในกลุ่มเป็นขอบเขตที่พอเสมอ แม้เลขที่ที่ระบุเองจะมีค่ามากมาก.
WITH roster AS (
  SELECT username, BTRIM(year) AS yr,
    regexp_replace(lower(department), '[^a-zA-Z0-9ก-๙]', '', 'g') AS cls, student_no
  FROM users WHERE UPPER(role)='STUDENT' AND BTRIM(COALESCE(year,''))<>''
    AND BTRIM(COALESCE(department,''))<>''
), groups AS (
  SELECT yr, cls, count(*)::integer AS size FROM roster GROUP BY yr, cls
), missing AS (
  SELECT username, yr, cls, row_number() OVER (PARTITION BY yr,cls ORDER BY username COLLATE "C") AS position
  FROM roster WHERE student_no IS NULL
), available AS (
  SELECT g.yr,g.cls,n AS student_no,
    row_number() OVER (PARTITION BY g.yr,g.cls ORDER BY n) AS position
  FROM groups g CROSS JOIN LATERAL generate_series(1,g.size) AS n
  WHERE NOT EXISTS (SELECT 1 FROM roster r WHERE r.yr=g.yr AND r.cls=g.cls AND r.student_no=n)
)
UPDATE users u SET student_no=a.student_no FROM missing m JOIN available a
  ON a.yr=m.yr AND a.cls=m.cls AND a.position=m.position
WHERE u.username=m.username;
