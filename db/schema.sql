-- PSSMS PostgreSQL Schema
-- Migrated from Google Sheets structure
-- Generated: 2026-05-18

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT NOT NULL,
  subkey      TEXT NOT NULL DEFAULT '',
  value1      TEXT,
  value2      TEXT,
  PRIMARY KEY (key, subkey)
);

CREATE TABLE IF NOT EXISTS users (
  username    TEXT PRIMARY KEY,
  password    TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('Admin','ADMIN','Teacher','TEACHER','Student','STUDENT','Executive','EXECUTIVE')),
  department  TEXT,
  email       TEXT,
  year        TEXT,
  status      TEXT DEFAULT 'ปกติ',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_history (
  id          SERIAL PRIMARY KEY,
  username    TEXT NOT NULL,
  action      TEXT,
  changed_by  TEXT,
  old_data    JSONB,
  new_data    JSONB,
  timestamp   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TIMETABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS timetable (
  id          SERIAL PRIMARY KEY,
  subject_code TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  level       TEXT NOT NULL,
  room        TEXT NOT NULL,
  location    TEXT,
  teacher_id  TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  period      TEXT NOT NULL,
  term        TEXT NOT NULL,
  year        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable(teacher_id, term, year);
CREATE INDEX IF NOT EXISTS idx_timetable_day ON timetable(day, term, year);

-- ============================================================
-- ATTENDANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS attendance (
  id          SERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  date        DATE NOT NULL,
  term        TEXT NOT NULL,
  year        TEXT NOT NULL,
  subject_code TEXT,
  subject_name TEXT,
  class       TEXT,
  period      TEXT,
  student_id  TEXT NOT NULL,
  student_name TEXT,
  status      TEXT NOT NULL,
  teacher_id  TEXT,
  session_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date, term, year);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, term, year);
CREATE INDEX IF NOT EXISTS idx_attendance_teacher ON attendance(teacher_id, term, year);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);

CREATE TABLE IF NOT EXISTS academic_records (
  id          SERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  date        DATE NOT NULL,
  term        TEXT NOT NULL,
  year        TEXT NOT NULL,
  subject_code TEXT,
  subject_name TEXT,
  class       TEXT,
  period      TEXT,
  topic       TEXT,
  present     INTEGER DEFAULT 0,
  absent      INTEGER DEFAULT 0,
  leave       INTEGER DEFAULT 0,
  teacher_id  TEXT,
  signature   TEXT,
  session_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_academic_teacher ON academic_records(teacher_id, term, year);

CREATE TABLE IF NOT EXISTS morning_activity (
  id          SERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  date        DATE NOT NULL,
  term        TEXT NOT NULL,
  year        TEXT NOT NULL,
  class       TEXT,
  student_id  TEXT NOT NULL,
  student_name TEXT,
  area_status TEXT,
  duty_status TEXT,
  flag_status TEXT,
  teacher_id  TEXT,
  session_id  TEXT
);

-- ============================================================
-- DETAILED LESSON RECORDS
-- ============================================================

CREATE TABLE IF NOT EXISTS detailed_lesson_records (
  id              SERIAL PRIMARY KEY,
  timestamp       TIMESTAMPTZ DEFAULT NOW(),
  date            DATE,
  term            TEXT,
  year            TEXT,
  subject_code    TEXT,
  subject_name    TEXT,
  class           TEXT,
  period          TEXT,
  topic           TEXT,
  outcomes        TEXT,
  problems        TEXT,
  solutions       TEXT,
  dpa_indicators  JSONB,
  skills_3r8c     JSONB,
  student_results TEXT,
  work_file_url   TEXT,
  atmosphere_url  TEXT,
  teacher_id      TEXT,
  session_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_dlr_teacher ON detailed_lesson_records(teacher_id, term, year);

-- ============================================================
-- SCORES (ปพ.5)
-- ============================================================

CREATE TABLE IF NOT EXISTS subject_config (
  subject_id    TEXT NOT NULL,
  subject_code  TEXT NOT NULL,
  class_name    TEXT NOT NULL,
  term          TEXT NOT NULL,
  year          TEXT NOT NULL,
  score_ratio   TEXT,
  indicators_json JSONB,
  teacher_id    TEXT,
  PRIMARY KEY (subject_code, class_name, term, year)
);

CREATE TABLE IF NOT EXISTS score_database (
  uid           TEXT NOT NULL,
  student_id    TEXT NOT NULL,
  subject_code  TEXT NOT NULL,
  indicator_id  TEXT NOT NULL,
  score         NUMERIC,
  term          TEXT NOT NULL,
  year          TEXT NOT NULL,
  PRIMARY KEY (student_id, subject_code, indicator_id, term, year)
);

CREATE INDEX IF NOT EXISTS idx_score_subject ON score_database(subject_code, term, year);

CREATE TABLE IF NOT EXISTS qualitative_assess (
  student_id      TEXT NOT NULL,
  subject_code    TEXT NOT NULL,
  term            TEXT NOT NULL,
  year            TEXT NOT NULL,
  reading_writing TEXT,
  char_json       JSONB,
  comp_json       JSONB,
  PRIMARY KEY (student_id, subject_code, term, year)
);

CREATE TABLE IF NOT EXISTS grade_summary (
  student_id          TEXT NOT NULL,
  subject_code        TEXT NOT NULL,
  total_score         NUMERIC,
  grade               TEXT,
  remedial_status     TEXT,
  attendance_percent  NUMERIC,
  term                TEXT NOT NULL,
  year                TEXT NOT NULL,
  PRIMARY KEY (student_id, subject_code, term, year)
);

CREATE TABLE IF NOT EXISTS score_history (
  id            SERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ DEFAULT NOW(),
  teacher_id    TEXT,
  student_id    TEXT,
  subject_code  TEXT,
  indicator_id  TEXT,
  old_score     NUMERIC,
  new_score     NUMERIC,
  term          TEXT,
  year          TEXT
);

CREATE TABLE IF NOT EXISTS print_config (
  term          TEXT NOT NULL,
  year          TEXT NOT NULL,
  sys_data      JSONB,
  homeroom_data JSONB,
  PRIMARY KEY (term, year)
);

-- ============================================================
-- CURRICULUM
-- ============================================================

CREATE TABLE IF NOT EXISTS curriculum (
  id            SERIAL PRIMARY KEY,
  subject_code  TEXT,
  subject_type  TEXT,
  standard_code TEXT,
  description   TEXT,
  eval_type     TEXT
);

CREATE INDEX IF NOT EXISTS idx_curriculum_code ON curriculum(subject_code);

-- ============================================================
-- BUDGET
-- ============================================================

CREATE TABLE IF NOT EXISTS budgets (
  project_id    TEXT PRIMARY KEY,
  project_name  TEXT NOT NULL,
  budget_amount NUMERIC DEFAULT 0,
  used_amount   NUMERIC DEFAULT 0,
  balance       NUMERIC GENERATED ALWAYS AS (budget_amount - used_amount) STORED,
  status        TEXT DEFAULT 'active',
  year          TEXT NOT NULL
);

-- ============================================================
-- LEAVE & SUBSTITUTES
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_records (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  teacher_id    TEXT NOT NULL,
  staff_name    TEXT,
  type          TEXT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days          NUMERIC DEFAULT 1,
  reason        TEXT,
  status        TEXT DEFAULT 'รอพิจารณา',
  year          TEXT,
  request_date  TIMESTAMPTZ DEFAULT NOW(),
  admin_comment TEXT,
  reviewed_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_leave_teacher ON leave_records(teacher_id, year);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_records(status);

CREATE TABLE IF NOT EXISTS substitute_assignments (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  leave_id              TEXT REFERENCES leave_records(id),
  date                  DATE NOT NULL,
  period                TEXT,
  day_of_week           TEXT,
  original_teacher_id   TEXT,
  original_teacher_name TEXT,
  sub_teacher_id        TEXT,
  sub_teacher_name      TEXT,
  subject_code          TEXT,
  subject_name          TEXT,
  class                 TEXT,
  room                  TEXT,
  status                TEXT DEFAULT 'รอจัด',
  assigned_by           TEXT,
  assigned_at           TIMESTAMPTZ DEFAULT NOW(),
  note                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sub_date ON substitute_assignments(date, status);
CREATE INDEX IF NOT EXISTS idx_sub_teacher ON substitute_assignments(sub_teacher_id);

-- ============================================================
-- CALENDAR
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  title       TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE,
  color       TEXT DEFAULT '#3b82f6',
  description TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_date);

-- ============================================================
-- CLUBS
-- ============================================================

CREATE TABLE IF NOT EXISTS clubs (
  club_id     TEXT PRIMARY KEY,
  club_name   TEXT NOT NULL,
  description TEXT,
  capacity    INTEGER DEFAULT 0,
  term        TEXT NOT NULL,
  year        TEXT NOT NULL,
  status      TEXT DEFAULT 'open',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clubs_term ON clubs(term, year);

CREATE TABLE IF NOT EXISTS club_advisors (
  club_id     TEXT NOT NULL REFERENCES clubs(club_id) ON DELETE CASCADE,
  teacher_id  TEXT NOT NULL,
  teacher_name TEXT,
  role        TEXT DEFAULT 'หัวหน้า',
  term        TEXT NOT NULL,
  year        TEXT NOT NULL,
  PRIMARY KEY (club_id, teacher_id, term, year)
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id       TEXT NOT NULL REFERENCES clubs(club_id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL,
  student_name  TEXT,
  class_name    TEXT,
  term          TEXT NOT NULL,
  year          TEXT NOT NULL,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  registered_by TEXT,
  PRIMARY KEY (student_id, term, year)
);

-- ============================================================
-- SARABUN (สารบรรณ)
-- ============================================================

CREATE TABLE IF NOT EXISTS sarabun (
  id          SERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  doc_type    TEXT,
  doc_number  TEXT,
  subject     TEXT,
  requester   TEXT,
  target_date DATE,
  status      TEXT DEFAULT 'รอดำเนินการ',
  file_url    TEXT,
  year        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sarabun_year ON sarabun(year);

-- ============================================================
-- MAINTENANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance (
  id          SERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ DEFAULT NOW(),
  location    TEXT,
  issue       TEXT,
  reporter    TEXT,
  status      TEXT DEFAULT 'รอดำเนินการ',
  technician  TEXT
);
