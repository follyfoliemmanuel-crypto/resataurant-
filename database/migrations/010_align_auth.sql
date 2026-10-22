-- Aligne les bases créées par l'ancienne génération de migrations
-- (_migrations : 001_initial_schema, 002_ops, 003_order_promo) sur le schéma
-- attendu par l'application. Idempotent : sans effet sur une base récente.

DO $$
BEGIN
  -- Ancien schéma : login_attempts.key_hash NOT NULL.
  -- L'application enregistre email_hash + ip_hash ; key_hash doit accepter NULL.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'login_attempts'
      AND column_name = 'key_hash'
  ) THEN
    ALTER TABLE login_attempts ALTER COLUMN key_hash DROP NOT NULL;
  END IF;

  -- Ancien schéma : roles.permissions en text[]. L'application écrit du JSONB.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'roles'
      AND column_name = 'permissions'
      AND data_type = 'ARRAY'
  ) THEN
    ALTER TABLE roles ALTER COLUMN permissions DROP DEFAULT;
    ALTER TABLE roles
      ALTER COLUMN permissions TYPE jsonb USING to_jsonb(permissions);
    ALTER TABLE roles ALTER COLUMN permissions SET DEFAULT '[]'::jsonb;
  END IF;
END
$$;
