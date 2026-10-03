-- Daily, cumulative product-usage counters. One deployment contains one school,
-- so no school/user identifier belongs in this table or in the central payload.
CREATE TABLE IF NOT EXISTS usage_analytics_daily (
  activity_date DATE PRIMARY KEY,
  app_version TEXT NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL,
  login_success BIGINT NOT NULL DEFAULT 0 CHECK (login_success >= 0),
  login_admin BIGINT NOT NULL DEFAULT 0 CHECK (login_admin >= 0),
  login_teacher BIGINT NOT NULL DEFAULT 0 CHECK (login_teacher >= 0),
  login_student BIGINT NOT NULL DEFAULT 0 CHECK (login_student >= 0),
  login_executive BIGINT NOT NULL DEFAULT 0 CHECK (login_executive >= 0),
  attendance_saved BIGINT NOT NULL DEFAULT 0 CHECK (attendance_saved >= 0),
  scores_saved BIGINT NOT NULL DEFAULT 0 CHECK (scores_saved >= 0),
  timetable_changed BIGINT NOT NULL DEFAULT 0 CHECK (timetable_changed >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_usage_analytics_pending
  ON usage_analytics_daily(updated_at, last_sent_at);
