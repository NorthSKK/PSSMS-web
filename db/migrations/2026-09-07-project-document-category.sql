ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'โครงการ';
CREATE INDEX IF NOT EXISTS idx_project_documents_category ON project_documents(category, updated_at DESC);
