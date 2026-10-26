ALTER TABLE users ADD COLUMN IF NOT EXISTS student_no INTEGER
  CONSTRAINT users_student_no_positive CHECK (student_no > 0);
CREATE UNIQUE INDEX IF NOT EXISTS users_student_no_unique
  ON users (BTRIM(year), (regexp_replace(lower(department), '[^a-zA-Z0-9ก-๙]', '', 'g')), student_no)
  WHERE UPPER(role)='STUDENT' AND student_no IS NOT NULL;
