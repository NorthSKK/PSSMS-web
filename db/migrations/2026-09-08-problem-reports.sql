-- รายงานปัญหาที่ส่งจาก deployment ของโรงเรียนไปยังหลังบ้าน PSSMS กลาง
-- ไฟล์ภาพไม่เก็บในฐานนี้: ถูกส่งต่อไปที่ R2 ของหลังบ้านทันที เพื่อไม่เปิดไฟล์
-- ให้คนในโรงเรียนอื่นหรือผู้ดูแลโรงเรียนเองเข้าถึงได้.
CREATE TABLE IF NOT EXISTS problem_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  reporter_name TEXT NOT NULL DEFAULT '',
  reporter_role TEXT NOT NULL DEFAULT '',
  school_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  page_key TEXT NOT NULL DEFAULT '',
  page_label TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL,
  app_build TEXT NOT NULL,
  deployed_at TIMESTAMPTZ,
  client_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  remote_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','delivered')),
  delivery_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_problem_reports_delivery ON problem_reports(delivery_status, created_at DESC);

CREATE TABLE IF NOT EXISTS problem_report_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES problem_reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL DEFAULT '',
  file_ext TEXT NOT NULL CHECK (file_ext IN ('jpg','png','webp')),
  file_size BIGINT NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  remote_file_id TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'delivered' CHECK (delivery_status IN ('delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_problem_report_attachments_report ON problem_report_attachments(report_id, created_at);
