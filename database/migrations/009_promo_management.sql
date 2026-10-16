-- Migration 009: Extension des promotions et historique des utilisations

ALTER TABLE promotions 
  ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(10,2) DEFAULT NULL CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
  ADD COLUMN IF NOT EXISTS max_uses INTEGER DEFAULT NULL CHECK (max_uses IS NULL OR max_uses > 0),
  ADD COLUMN IF NOT EXISTS max_uses_per_user INTEGER DEFAULT NULL CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),
  ADD COLUMN IF NOT EXISTS uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0);

CREATE TABLE IF NOT EXISTS promo_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  promotion_id UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  client_email TEXT,
  discount_amount NUMERIC(10,2) NOT NULL CHECK (discount_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_usages_promo ON promo_usages(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promo_usages_order ON promo_usages(order_id);
CREATE INDEX IF NOT EXISTS idx_promo_usages_user ON promo_usages(restaurant_id, promotion_id, user_id);
CREATE INDEX IF NOT EXISTS idx_promo_usages_email ON promo_usages(restaurant_id, promotion_id, client_email);
