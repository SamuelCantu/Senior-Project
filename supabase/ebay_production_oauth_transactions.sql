CREATE TABLE IF NOT EXISTS public.ebay_production_oauth_transactions (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ebay_production_oauth_transactions_expires_at_idx
  ON public.ebay_production_oauth_transactions (expires_at);

ALTER TABLE public.ebay_production_oauth_transactions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ebay_production_oauth_transactions FROM anon, authenticated;
GRANT ALL ON TABLE public.ebay_production_oauth_transactions TO service_role;
