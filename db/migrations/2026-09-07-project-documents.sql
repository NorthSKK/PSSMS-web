CREATE TABLE IF NOT EXISTS project_documents (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_files (
  id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL, file_name TEXT NOT NULL DEFAULT '', file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_documents_updated ON project_documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id,id);
