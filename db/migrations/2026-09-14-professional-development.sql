-- Personal professional-development records.  Owner ids deliberately have no FK:
-- an employee record must remain auditable after the account is archived.
CREATE TABLE IF NOT EXISTS professional_development_activities (
  id SERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('อบรม','สัมมนา','ประชุม','ไปราชการ','ศึกษาดูงาน')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  location TEXT NOT NULL DEFAULT '', organizer TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ร่าง' CHECK (status IN ('ร่าง','เสร็จสิ้น','ยกเลิก')),
  hours NUMERIC(6,2), expenses NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pd_owner_live ON professional_development_activities(owner_id, starts_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pd_owner_trash ON professional_development_activities(owner_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS professional_development_participants (
  id SERIAL PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES professional_development_activities(id) ON DELETE CASCADE,
  participant_kind TEXT NOT NULL CHECK (participant_kind IN ('teacher','student','external')),
  reference_id TEXT, label TEXT NOT NULL, role_label TEXT NOT NULL DEFAULT '', class_name TEXT NOT NULL DEFAULT '',
  UNIQUE(activity_id, participant_kind, reference_id, label)
);
CREATE INDEX IF NOT EXISTS idx_pd_participants_activity ON professional_development_participants(activity_id, id);

CREATE TABLE IF NOT EXISTS professional_development_attachments (
  id SERIAL PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES professional_development_activities(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '', file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pd_attachments_activity ON professional_development_attachments(activity_id, id);

CREATE TABLE IF NOT EXISTS professional_development_notifications (
  id SERIAL PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES professional_development_activities(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'follow_up', message TEXT NOT NULL,
  read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(activity_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_pd_notifications_owner ON professional_development_notifications(owner_id, read_at, created_at DESC);
