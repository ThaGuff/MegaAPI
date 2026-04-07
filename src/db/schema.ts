// ─── Database Schema Definitions ─────────────────────────────────────────────
// These SQL strings are used to initialise the Supabase/Postgres database.
// Run them once via the Supabase SQL editor or a migration tool.

export const CREATE_BUSINESSES_TABLE = `
CREATE TABLE IF NOT EXISTS businesses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  industry    TEXT NOT NULL,
  website     TEXT,
  region      TEXT,
  api_key     TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  plan        TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','growth','premium')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CREATE_SUBSCRIPTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan             TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','growth','premium')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  frequency        TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('daily','weekly','monthly')),
  next_report_date TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 month',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CREATE_REPORTS_TABLE = `
CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT 'Revenue Intelligence Report',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  data         JSONB NOT NULL DEFAULT '{}',
  html_content TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','ready','sent','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CREATE_API_CATALOG_TABLE = `
CREATE TABLE IF NOT EXISTS api_catalog (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL,
  affiliate_url  TEXT NOT NULL,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  industries     TEXT[] NOT NULL DEFAULT '{}',
  revenue_levers TEXT[] NOT NULL DEFAULT '{}',
  data_sources   TEXT[] NOT NULL DEFAULT '{}',
  impact_level   TEXT NOT NULL DEFAULT 'Medium' CHECK (impact_level IN ('High','Medium','Low')),
  use_cases      TEXT[] NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CREATE_BUSINESS_SOLUTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS business_solutions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  api_id           UUID NOT NULL REFERENCES api_catalog(id) ON DELETE CASCADE,
  use_case         TEXT NOT NULL,
  impact_estimate  NUMERIC NOT NULL DEFAULT 0,
  savings_estimate NUMERIC NOT NULL DEFAULT 0,
  score            INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  status           TEXT NOT NULL DEFAULT 'recommended' CHECK (status IN ('recommended','in_progress','implemented','dismissed')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CREATE_SCHEDULED_JOBS_TABLE = `
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL CHECK (job_type IN ('report_generation','email_send','data_refresh')),
  schedule      TEXT NOT NULL,
  last_run      TIMESTAMPTZ,
  next_run      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_businesses_email       ON businesses(email);
CREATE INDEX IF NOT EXISTS idx_businesses_api_key     ON businesses(api_key);
CREATE INDEX IF NOT EXISTS idx_subscriptions_business ON subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_reports_business       ON reports(business_id);
CREATE INDEX IF NOT EXISTS idx_reports_status         ON reports(status);
CREATE INDEX IF NOT EXISTS idx_api_catalog_category   ON api_catalog(category);
CREATE INDEX IF NOT EXISTS idx_api_catalog_impact     ON api_catalog(impact_level);
CREATE INDEX IF NOT EXISTS idx_solutions_business     ON business_solutions(business_id);
CREATE INDEX IF NOT EXISTS idx_jobs_business          ON scheduled_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run          ON scheduled_jobs(next_run);
`;

export const CREATE_UPDATED_AT_TRIGGER = `
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

// All DDL statements in execution order
export const ALL_MIGRATIONS = [
  CREATE_BUSINESSES_TABLE,
  CREATE_SUBSCRIPTIONS_TABLE,
  CREATE_REPORTS_TABLE,
  CREATE_API_CATALOG_TABLE,
  CREATE_BUSINESS_SOLUTIONS_TABLE,
  CREATE_SCHEDULED_JOBS_TABLE,
  CREATE_INDEXES,
  CREATE_UPDATED_AT_TRIGGER,
];
