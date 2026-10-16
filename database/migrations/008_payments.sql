
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  order_id UUID NOT NULL
    REFERENCES orders(id) ON DELETE RESTRICT,

  provider TEXT NOT NULL DEFAULT 'paygateglobal',

  payment_method TEXT NOT NULL
    CHECK (payment_method IN ('flooz', 'tmoney')),

  amount NUMERIC(10, 2) NOT NULL
    CHECK (amount > 0),

  currency TEXT NOT NULL DEFAULT 'XOF',

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'processing',
      'paid',
      'failed',
      'cancelled'
    )),

  provider_reference TEXT UNIQUE,
  provider_transaction_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id
  ON payments(order_id);

CREATE INDEX IF NOT EXISTS idx_payments_status
  ON payments(status);
