-- Migration 013: Extension des paiements pour GeniusPay (Mobile Money & Cartes)
-- Supporte les paiements multi-opérateurs (T-Money, Moov, MTN, Orange, Wave, Carte)
-- et la journalisation idempotente des événements de webhook.

-- 1. Assouplissement de la contrainte sur payment_method pour accepter les méthodes GeniusPay
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_payment_method_check 
  CHECK (payment_method IN ('flooz', 'tmoney', 'geniuspay', 'wave', 'orange_money', 'mtn', 'moov', 'card', 'hosted'));

-- 2. Assouplissement de la contrainte sur status pour gérer les statuts GeniusPay (refunded, expired)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check 
  CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled', 'refunded', 'expired'));

-- 3. Ajout de colonnes pour stocker l'URL de checkout hébergé et les métadonnées de transaction
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 4. Table des événements de webhook pour garantir l'idempotence et l'audit
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'geniuspay',
  event_id TEXT,
  event_type TEXT NOT NULL,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_id ON payment_events(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_order_id ON payment_events(order_id);
