PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  season_label TEXT NULL,
  avatar_data TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  website TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS job_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position TEXT DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT 'new_grad' CHECK (employment_type IN ('intern', 'new_grad', 'experienced', 'other')),
  url TEXT DEFAULT '',
  deadline DATE,
  memo TEXT DEFAULT '',
  is_bookmarked INTEGER NOT NULL DEFAULT 0 CHECK (is_bookmarked IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_post_id INTEGER NOT NULL UNIQUE REFERENCES job_posts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'document' CHECK (stage IN ('document', 'coding_test', 'assignment', 'interview1', 'interview2', 'final')),
  result TEXT NOT NULL DEFAULT 'in_progress' CHECK (result IN ('in_progress', 'passed', 'failed', 'withdrawn')),
  board_order INTEGER NOT NULL DEFAULT 0,
  applied_at DATE,
  memo TEXT DEFAULT '',
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  from_result TEXT,
  to_result TEXT NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  spec_item_id INTEGER REFERENCES spec_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('deadline', 'test', 'interview', 'announcement', 'other')),
  starts_at DATETIME NOT NULL,
  memo TEXT DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS essays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS essay_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id INTEGER NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  question TEXT NOT NULL,
  char_limit INTEGER,
  answer TEXT NOT NULL DEFAULT '',
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS essay_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  essay_id INTEGER NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  label TEXT DEFAULT '',
  snapshot_json TEXT NOT NULL,
  restored_from_version_id INTEGER REFERENCES essay_versions(id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(essay_id, version_no)
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'experience' CHECK (kind IN ('experience', 'project', 'award', 'activity', 'other')),
  title TEXT NOT NULL,
  period TEXT DEFAULT '',
  content TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS essay_materials (
  essay_id INTEGER NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  PRIMARY KEY (essay_id, material_id)
);

CREATE TABLE IF NOT EXISTS interview_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('ai', 'manual')),
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id INTEGER NULL REFERENCES applications(id) ON DELETE SET NULL,
  spec_item_id INTEGER NULL REFERENCES spec_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) <= 120),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('essay', 'interview', 'coding_test', 'assignment', 'other')),
  due_date DATE NULL,
  is_done INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  done_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monthly_goals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target >= 1 AND target <= 200),
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS essay_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  essay_id INTEGER NOT NULL REFERENCES essays(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES essay_questions(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_star_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  briefing_date TEXT NOT NULL CHECK (briefing_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, briefing_date)
);

-- Shared cache of third-party favicon lookups keyed by normalized domain (no user data).
CREATE TABLE IF NOT EXISTS company_logos (
  domain TEXT PRIMARY KEY,
  content_type TEXT,
  data BLOB,
  status TEXT NOT NULL CHECK (status IN ('ok', 'missing')),
  fetched_at INTEGER NOT NULL
);

-- source_ref NULL(직접 입력)은 UNIQUE 비교에서 서로 다른 값으로 취급되어 중복 허용.
CREATE TABLE IF NOT EXISTS spec_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('certificate', 'bootcamp', 'contest', 'activity', 'grad_school', 'other')),
  title TEXT NOT NULL CHECK (length(title) <= 200),
  organizer TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('qnet', 'dataq', 'alio', 'work24', 'ai_verified', 'manual')),
  source_ref TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'interested' CHECK (status IN ('interested', 'applied', 'in_progress', 'completed', 'passed', 'failed', 'dropped')),
  apply_start TEXT,
  apply_end TEXT,
  event_date TEXT,
  end_date TEXT,
  result_date TEXT,
  memo TEXT,
  material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, source, source_ref)
);

CREATE TABLE IF NOT EXISTS spec_watch (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cert_code TEXT NOT NULL,
  cert_name TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, cert_code)
);

-- Shared cache of external API responses (no user data). TTL enforced by readers.
CREATE TABLE IF NOT EXISTS external_cache (
  source TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source, query_hash)
);

CREATE INDEX IF NOT EXISTS idx_spec_items_user_id ON spec_items(user_id);
CREATE INDEX IF NOT EXISTS idx_spec_items_user_status ON spec_items(user_id, status);
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_job_posts_user_id ON job_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_job_posts_company_id ON job_posts(company_id);
CREATE INDEX IF NOT EXISTS idx_job_posts_deadline ON job_posts(deadline);
CREATE INDEX IF NOT EXISTS idx_applications_user_id ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_stage ON applications(user_id, stage);
CREATE INDEX IF NOT EXISTS idx_stage_logs_application_id ON stage_logs(application_id);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);
CREATE INDEX IF NOT EXISTS idx_essays_user_id ON essays(user_id);
CREATE INDEX IF NOT EXISTS idx_essay_questions_essay_id ON essay_questions(essay_id);
CREATE INDEX IF NOT EXISTS idx_essay_versions_essay_id ON essay_versions(essay_id);
CREATE INDEX IF NOT EXISTS idx_materials_user_id ON materials(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_questions_user_id ON interview_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_done_due ON todos(user_id, is_done, due_date);
CREATE INDEX IF NOT EXISTS idx_essay_feedback_lookup ON essay_feedback(user_id, essay_id, question_id, id);
CREATE INDEX IF NOT EXISTS idx_material_star_drafts_lookup ON material_star_drafts(user_id, material_id, id);
CREATE INDEX IF NOT EXISTS idx_ai_briefings_user_date ON ai_briefings(user_id, briefing_date);
