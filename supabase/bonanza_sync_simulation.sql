-- ListNexus / Bonanza test-only transactional order simulation.
-- Run once in Supabase SQL Editor. No permanent inventory changes are made
-- when the function is called: it deliberately rolls back its inner block.
-- It uses your EXISTING public.apply_bonanza_sale function.
-- No real Bonanza API calls are made by this function.

CREATE OR REPLACE FUNCTION public.dry_run_bonanza_sales(
  p_user_id uuid,
  p_product_id uuid,
  p_item_id text,
  p_sales jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start integer;
  v_simulated integer;
  v_after integer;
  v_saved_rows integer;
  v_first_id text;
  v_second_id text;
  v_third_id text;
  v_first jsonb;
  v_duplicate jsonb;
  v_second jsonb;
  v_oversold jsonb;
BEGIN
  -- This test expects exactly three PAID orders from our real TypeScript parser:
  -- 2 items, 1 item, and an oversized request for 999 items.
  IF p_sales IS NULL OR jsonb_typeof(p_sales) <> 'array'
     OR jsonb_array_length(p_sales) <> 3 THEN
    RAISE EXCEPTION 'Simulation must contain exactly three parsed paid orders';
  END IF;

  IF p_item_id IS NULL OR p_item_id !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Invalid Bonanza test item ID';
  END IF;

  v_first_id := p_sales->0->>'orderId';
  v_second_id := p_sales->1->>'orderId';
  v_third_id := p_sales->2->>'orderId';

  IF v_first_id IS NULL OR v_second_id IS NULL OR v_third_id IS NULL
     OR v_first_id !~ '^[0-9]+$' OR v_second_id !~ '^[0-9]+$'
     OR v_third_id !~ '^[0-9]+$'
     OR v_first_id = v_second_id OR v_first_id = v_third_id
     OR v_second_id = v_third_id THEN
    RAISE EXCEPTION 'Parsed mock order IDs are invalid or repeated';
  END IF;

  IF p_sales->0->>'itemId' IS DISTINCT FROM p_item_id
     OR p_sales->1->>'itemId' IS DISTINCT FROM p_item_id
     OR p_sales->2->>'itemId' IS DISTINCT FROM p_item_id
     OR p_sales->0->>'quantity' <> '2'
     OR p_sales->1->>'quantity' <> '1'
     OR p_sales->2->>'quantity' <> '999' THEN
    RAISE EXCEPTION 'The parser did not produce the expected paid order lines';
  END IF;

  SELECT quantity INTO v_start
    FROM public.products
   WHERE id = p_product_id AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND OR v_start < 3 OR v_start >= 999 THEN
    RAISE EXCEPTION 'Expected an owned test product with stock between 3 and 998';
  END IF;

  -- A PL/pgSQL block with EXCEPTION forms a subtransaction. Deliberately
  -- raising our dedicated SQLSTATE at the bottom rolls back ALL changes made
  -- by apply_bonanza_sale, including order-line inserts and stock deductions.
  BEGIN
    v_first := public.apply_bonanza_sale(
      p_user_id, p_product_id, v_first_id, p_item_id, 2);
    v_duplicate := public.apply_bonanza_sale(
      p_user_id, p_product_id, v_first_id, p_item_id, 2);
    v_second := public.apply_bonanza_sale(
      p_user_id, p_product_id, v_second_id, p_item_id, 1);
    v_oversold := public.apply_bonanza_sale(
      p_user_id, p_product_id, v_third_id, p_item_id, 999);

    SELECT quantity INTO v_simulated
      FROM public.products
     WHERE id = p_product_id AND user_id = p_user_id;

    SELECT count(*) INTO v_saved_rows
      FROM public.bonanza_order_lines
     WHERE user_id = p_user_id AND item_id = p_item_id
       AND order_id IN (v_first_id, v_second_id, v_third_id);

    IF v_first->>'result' <> 'applied'
       OR v_duplicate->>'result' <> 'duplicate'
       OR v_second->>'result' <> 'applied'
       OR v_oversold->>'result' <> 'oversold'
       OR v_simulated <> v_start - 3
       OR v_saved_rows <> 3 THEN
      RAISE EXCEPTION 'Inventory accounting assertions failed';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001',
      MESSAGE = 'Bonanza simulation: intentional subtransaction rollback';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    -- All writes from the above inner block have been rolled back.
    NULL;
  END;

  SELECT quantity INTO v_after
    FROM public.products
   WHERE id = p_product_id AND user_id = p_user_id;

  SELECT count(*) INTO v_saved_rows
    FROM public.bonanza_order_lines
   WHERE user_id = p_user_id AND item_id = p_item_id
     AND order_id IN (v_first_id, v_second_id, v_third_id);

  IF v_after IS DISTINCT FROM v_start OR v_saved_rows <> 0 THEN
    RAISE EXCEPTION 'Safety check failed: simulation was not fully rolled back';
  END IF;

  RETURN jsonb_build_object(
    'passed', true,
    'originalQuantity', v_start,
    'quantityDuringSimulation', v_simulated,
    'quantityAfterRollback', v_after,
    'firstSale', v_first->>'result',
    'duplicateSale', v_duplicate->>'result',
    'secondSale', v_second->>'result',
    'oversoldSale', v_oversold->>'result',
    'testOrderRecordsRemaining', v_saved_rows,
    'permanentChanges', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dry_run_bonanza_sales(uuid,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dry_run_bonanza_sales(uuid,uuid,text,jsonb)
  TO service_role;
