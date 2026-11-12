-- ListNexus inventory-change outbox, phase 1 (no marketplace API calls).
-- Apply in Supabase SQL Editor. Adds one new table and one trigger.
-- Does not alter or drop existing eBay/Bonanza tables or API functions.

CREATE TABLE IF NOT EXISTS public.inventory_sync_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  old_quantity integer NOT NULL CHECK (old_quantity >= 0),
  new_quantity integer NOT NULL CHECK (new_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_sync_events_product_idx
  ON public.inventory_sync_events (user_id, product_id, id DESC);

-- Client-side users cannot insert/falsify the audit log. The trigger runs
-- with the database owner's privileges. Only trusted backend can read it.
ALTER TABLE public.inventory_sync_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.inventory_sync_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.inventory_sync_events TO service_role;

CREATE OR REPLACE FUNCTION public.listnexus_record_quantity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.inventory_sync_events
    (user_id, product_id, old_quantity, new_quantity)
  VALUES
    (NEW.user_id, NEW.id, OLD.quantity, NEW.quantity);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.listnexus_record_quantity_change()
  FROM PUBLIC, anon, authenticated;

-- Re-running this script replaces only OUR trigger, not your team's triggers.
DROP TRIGGER IF EXISTS listnexus_quantity_change_outbox ON public.products;
CREATE TRIGGER listnexus_quantity_change_outbox
AFTER UPDATE OF quantity ON public.products
FOR EACH ROW
WHEN (OLD.quantity IS DISTINCT FROM NEW.quantity)
EXECUTE FUNCTION public.listnexus_record_quantity_change();

-- Verification: the table and trigger should each show up once.
SELECT
  to_regclass('public.inventory_sync_events') AS event_table,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.products'::regclass
      AND tgname = 'listnexus_quantity_change_outbox'
      AND NOT tgisinternal
  ) AS trigger_installed;
