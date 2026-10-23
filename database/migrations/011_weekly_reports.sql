-- Rapports hebdomadaires : métadonnées et PDF persistants.
-- Les PDF sont stockés dans Neon (BYTEA) : aucun fichier sur le disque
-- éphémère des fonctions Vercel. La contrainte UNIQUE garantit l'idempotence
-- d'une semaine pour un restaurant donné.

CREATE TABLE IF NOT EXISTS weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  generated_by TEXT NOT NULL DEFAULT 'cron' CHECK (
    generated_by IN ('cron', 'manual')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  file_data BYTEA,
  file_name TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes > 0),
  summary JSONB,
  error_message TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT weekly_reports_restaurant_week_unique UNIQUE (restaurant_id, week_start),
  CONSTRAINT weekly_reports_week_bounds CHECK (week_end = week_start + 6)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_restaurant_week
  ON weekly_reports(restaurant_id, week_start DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_status
  ON weekly_reports(status);
