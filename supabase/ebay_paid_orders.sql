-- ListNexus: new, separate eBay Production order deduplication table.
-- Safe to run independently of existing eBay/Bonanza tables.
-- First install this before enabling EBAY_ENABLE_ORDER_IMPORT.
CREATE TABLE IF NOT EXISTS public.ebay_order_deductions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  order_id text NOT NULL CHECK (length(order_id) > 0),
  listing_id text NOT NULL CHECK (length(listing_id) > 0),
  line_item_ids text[] NOT NULL CHECK (cardinality(line_item_ids) > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('applied', 'oversold')),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id, order_id)
);

CREATE INDEX IF NOT EXISTS ebay_order_deductions_recent_idx
  ON public.ebay_order_deductions (user_id, processed_at DESC);

ALTER TABLE public.ebay_order_deductions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ebay_order_deductions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.ebay_order_deductions TO service_role;

CREATE OR REPLACE FUNCTION public.apply_ebay_paid_order(
    p_user_id uuid,
    p_product_id uuid,
    p_order_id text,
    p_listing_id text,
    p_quantity integer,
    p_line_item_ids text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_available integer;
    v_remaining integer;
    v_existing public.ebay_order_deductions%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR p_product_id IS NULL OR
       p_order_id IS NULL OR btrim(p_order_id) = '' OR
       p_listing_id IS NULL OR btrim(p_listing_id) = '' OR
       p_quantity IS NULL OR p_quantity <= 0 OR
       p_line_item_ids IS NULL OR cardinality(p_line_item_ids) = 0 OR
       array_position(p_line_item_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid eBay sale parameters';
    END IF;

    -- Serialization point for concurrent workers and concurrent sales to this product.
    SELECT quantity INTO v_available
      FROM public.products
     WHERE id = p_product_id AND user_id = p_user_id
       AND status IN ('AVAILABLE', 'SOLD_OUT')
       AND quantity >= 0
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found or unavailable for eBay order import';
    END IF;

    SELECT * INTO v_existing
      FROM public.ebay_order_deductions
     WHERE user_id = p_user_id AND product_id = p_product_id
       AND order_id = p_order_id;
    IF FOUND THEN
        IF v_existing.quantity <> p_quantity OR
           v_existing.listing_id <> p_listing_id OR
           v_existing.line_item_ids <> p_line_item_ids THEN
            RETURN jsonb_build_object('result','conflict','remaining',v_available);
        END IF;
        RETURN jsonb_build_object('result','duplicate','priorStatus',v_existing.status,'remaining',v_available);
    END IF;

    IF v_available < p_quantity THEN
        INSERT INTO public.ebay_order_deductions
          (user_id, product_id, order_id, listing_id, line_item_ids, quantity, status)
        VALUES
          (p_user_id, p_product_id, p_order_id, p_listing_id, p_line_item_ids, p_quantity, 'oversold');
        RETURN jsonb_build_object('result','oversold','remaining',v_available);
    END IF;

    v_remaining := v_available - p_quantity;
    UPDATE public.products
       SET quantity = v_remaining,
           status = CASE WHEN v_remaining = 0 THEN 'SOLD_OUT' ELSE 'AVAILABLE' END,
           updated_at = now()
     WHERE id = p_product_id AND user_id = p_user_id;

    INSERT INTO public.ebay_order_deductions
      (user_id, product_id, order_id, listing_id, line_item_ids, quantity, status)
    VALUES
      (p_user_id, p_product_id, p_order_id, p_listing_id, p_line_item_ids, p_quantity, 'applied');

    RETURN jsonb_build_object('result','applied','remaining',v_remaining);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ebay_paid_order(uuid,uuid,text,text,integer,text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ebay_paid_order(uuid,uuid,text,text,integer,text[])
  TO service_role;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regclass('public.ebay_order_deductions') AS tracking_table,
  to_regprocedure('public.apply_ebay_paid_order(uuid,uuid,text,text,integer,text[])') AS atomic_function;
