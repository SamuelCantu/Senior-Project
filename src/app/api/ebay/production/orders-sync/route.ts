import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductionEbayAccessToken } from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EbayLine = {
  lineItemId?: string;
  sku?: string;
  legacyItemId?: string;
  quantity?: number;
  refunds?: unknown[];
};
type EbayOrder = {
  orderId?: string;
  creationDate?: string;
  orderPaymentStatus?: string;
  cancelStatus?: { cancelState?: string };
  paymentSummary?: { refunds?: unknown[] };
  lineItems?: EbayLine[];
};
type EbayOrdersPage = { orders?: EbayOrder[]; total?: number };
type Sale = { orderId: string; quantity: number; listingId: string; lineItemIds: string[] };
type Config = { ownerId: string; sku: string; since: Date };

let running = false;

function configuration(): Config {
  const ownerId = process.env.EBAY_ORDER_SYNC_OWNER_ID ||
    process.env.INVENTORY_SYNC_OWNER_ID || process.env.BONANZA_TEST_OWNER_ID || "";
  const sku = process.env.EBAY_ORDER_SYNC_SKU || process.env.INVENTORY_SYNC_SKU || "";
  const rawSince = process.env.EBAY_ORDER_SYNC_SINCE || "";
  const since = new Date(rawSince);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new Error("Missing or invalid EBAY_ORDER_SYNC_OWNER_ID (or INVENTORY_SYNC_OWNER_ID).");
  }
  if (!sku || sku.length > 50 || /[\x00-\x1f\x7f]/.test(sku)) {
    throw new Error("Missing or invalid EBAY_ORDER_SYNC_SKU.");
  }
  if (!/\d{4}-\d{2}-\d{2}T/.test(rawSince) || !Number.isFinite(since.getTime()) ||
      since.getTime() > Date.now() || since.getTime() < Date.now() - 89 * 86400000) {
    throw new Error("Set EBAY_ORDER_SYNC_SINCE to a UTC ISO timestamp within the last 89 days, not in the future.");
  }
  return { ownerId, sku, since };
}

function isSecretValid(value: string | null): boolean {
  const expected = process.env.INVENTORY_SYNC_WORKER_SECRET;
  if (!expected || expected.length < 32 || !value) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(value, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function loadAllOrders(token: string, since: Date): Promise<EbayOrder[]> {
  const orders: EbayOrder[] = [];
  const limit = 100;
  for (let page = 0; page < 10; page++) {
    const url = new URL("https://api.ebay.com/sell/fulfillment/v1/order");
    url.searchParams.set("filter", `creationdate:[${since.toISOString()}..]`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(page * limit));
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        throw new Error(`eBay order API HTTP ${response.status}: Production OAuth connection may lack sell.fulfillment.readonly; reconnect with the fulfillment scope.`);
      }
      throw new Error(`eBay order API failed: HTTP ${response.status}.`);
    }
    const data = (await response.json()) as EbayOrdersPage;
    if (!Array.isArray(data.orders)) throw new Error("eBay returned an order response without orders[].");
    orders.push(...data.orders);
    const total = data.total == null ? null : Number(data.total);
    if (total !== null && (!Number.isSafeInteger(total) || total < 0)) throw new Error("Invalid eBay order total.");
    if (data.orders.length < limit && (total === null || orders.length >= total)) return orders;
    if (total !== null && orders.length >= total) return orders;
  }
  throw new Error("Order pagination limit reached; refused to skip orders.");
}

function parseSales(orders: EbayOrder[], sku: string, listingId: string, since: Date) {
  const matching = new Map<string, Sale>();
  const needsReview: Array<{ orderId: string; reason: string }> = [];
  let ignored = 0;
  for (const order of orders) {
    const lines = Array.isArray(order.lineItems) ? order.lineItems : [];
    const matched: EbayLine[] = [];
    for (const line of lines) {
      const skuMatches = line.sku === sku;
      const itemMatches = String(line.legacyItemId ?? "") === listingId;
      if (!skuMatches && !itemMatches) continue;
      // Matching one identifier but contradicting the other is not safe.
      if ((line.sku && !skuMatches) || (line.legacyItemId && !itemMatches)) {
        throw new Error("eBay SKU and listing ID disagree on a sold line; manual review required.");
      }
      matched.push(line);
    }
    if (!matched.length) { ignored++; continue; }
    const orderId = String(order.orderId ?? "");
    if (!orderId || orderId.length > 150) throw new Error("Invalid eBay order ID.");
    const created = new Date(order.creationDate ?? "");
    if (!Number.isFinite(created.getTime()) || created.getTime() < since.getTime()) {
      throw new Error("eBay returned an order outside the requested start time.");
    }
    if (order.orderPaymentStatus !== "PAID") { ignored++; continue; }
    if (order.cancelStatus?.cancelState !== "NONE_REQUESTED") {
      needsReview.push({ orderId, reason: "Cancellation state requires review" });
      continue;
    }
    if ((order.paymentSummary?.refunds?.length ?? 0) > 0 ||
        matched.some(line => (line.refunds?.length ?? 0) > 0)) {
      needsReview.push({ orderId, reason: "Refund data requires review" });
      continue;
    }
    let quantity = 0;
    const lineItemIds: string[] = [];
    for (const line of matched) {
      if (!line.lineItemId || !Number.isSafeInteger(line.quantity) ||
          Number(line.quantity) <= 0 || line.quantity! > 100000) {
        throw new Error("Invalid eBay order line ID or quantity.");
      }
      quantity += line.quantity!;
      lineItemIds.push(line.lineItemId);
    }
    if (!Number.isSafeInteger(quantity) || new Set(lineItemIds).size !== lineItemIds.length) {
      throw new Error("Invalid or repeated order line quantity / ID.");
    }
    lineItemIds.sort();
    const sale = { orderId, quantity, listingId, lineItemIds };
    const previous = matching.get(orderId);
    if (previous && (previous.quantity !== sale.quantity ||
        previous.lineItemIds.join("|") !== lineItemIds.join("|"))) {
      throw new Error("Conflicting data for the same eBay order across pages.");
    }
    matching.set(orderId, sale);
  }
  return { sales: [...matching.values()], needsReview, ignored };
}

async function getSyncState(ownerId: string, sku: string, since: Date) {
  const admin = createAdminClient();
  const { data: products, error: pError } = await admin.from("products")
    .select("id,user_id,sku,quantity,status")
    .eq("user_id", ownerId).eq("sku", sku).limit(2);
  if (pError || !products || products.length !== 1) throw new Error("Expected exactly one owned central product.");
  const product = products[0];
  if (!Number.isSafeInteger(Number(product.quantity)) || Number(product.quantity) < 0) {
    throw new Error("Invalid central stock quantity.");
  }
  const { data: maps, error: mError } = await admin.from("marketplace_listings")
    .select("id,product_id,external_listing_id,external_offer_id,status")
    .eq("product_id", product.id).eq("marketplace", "EBAY")
    .eq("environment", "PRODUCTION").limit(2);
  if (mError || !maps || maps.length !== 1 || maps[0].status !== "ACTIVE") {
    throw new Error("Expected exactly one active eBay Production mapping for the central product.");
  }
  const listingId = String(maps[0].external_listing_id ?? "");
  if (!listingId || !maps[0].external_offer_id) throw new Error("Incomplete eBay Production listing mapping.");

  const token = await getProductionEbayAccessToken(ownerId);
  const apiOrders = await loadAllOrders(token, since);
  const parsed = parseSales(apiOrders, sku, listingId, since);
  const ids = parsed.sales.map(x => x.orderId);
  const previous = new Map<string, { quantity: number; status: string; line_item_ids: string[] }>();
  // Batch the read so an unusually large result cannot exceed query URL limits.
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from("ebay_order_deductions")
      .select("order_id,quantity,status,line_item_ids")
      .eq("user_id", ownerId).eq("product_id", product.id)
      .in("order_id", ids.slice(i, i + 100));
    if (error) throw new Error(`Could not read eBay order deduplication records: ${error.message}`);
    for (const row of data ?? []) previous.set(row.order_id, row);
  }
  const conflicts = parsed.sales.filter(sale => {
    const prior = previous.get(sale.orderId);
    return prior && (prior.quantity !== sale.quantity ||
      [...prior.line_item_ids].sort().join("|") !== sale.lineItemIds.join("|"));
  });
  const unresolved = parsed.sales.filter(sale => previous.get(sale.orderId)?.status === "oversold");
  if (conflicts.length || unresolved.length) {
    throw new Error("Previously imported eBay orders changed or oversold orders remain; manual reconciliation required.");
  }
  return { admin, product, parsed, pending: parsed.sales.filter(sale => !previous.has(sale.orderId)),
    processedCount: parsed.sales.length - parsed.sales.filter(sale => !previous.has(sale.orderId)).length };
}

export async function GET() {
  try {
    const { ownerId, sku, since } = configuration();
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return Response.json({ error: "Log in first" }, { status: 401 });
    if (user.id !== ownerId) return Response.json({ error: "Not your eBay account" }, { status: 403 });
    const state = await getSyncState(ownerId, sku, since);
    return Response.json({ success: true, mode: "preview", environment: "PRODUCTION", sku,
      since: since.toISOString(), centralQuantity: state.product.quantity,
      matchingPaidOrders: state.parsed.sales.length, alreadyProcessed: state.processedCount,
      pending: state.pending, reviewRequired: state.parsed.needsReview,
      note: "Read-only; no central inventory changes. Cancelled/refunded orders require manual review." });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown";
    console.error("eBay order preview:", detail);
    return Response.json({ success: false, error: detail }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!isSecretValid(request.headers.get("x-listnexus-sync-secret"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.EBAY_ENABLE_ORDER_IMPORT !== "true") {
    return Response.json({ success: false, action: "disabled", note: "Set EBAY_ENABLE_ORDER_IMPORT=true only after confirming the start-time baseline and OAuth scope." }, { status: 403 });
  }
  if (running) return Response.json({ success: false, action: "already-running" }, { status: 409 });
  running = true;
  try {
    const { ownerId, sku, since } = configuration();
    const { admin, product, parsed, pending } = await getSyncState(ownerId, sku, since);
    if (parsed.needsReview.length) {
      return Response.json({ success: false, action: "manual-review", orders: parsed.needsReview,
        note: "No new orders deducted; review cancellations/refunds first." }, { status: 409 });
    }
    const applied: Array<{ orderId: string; result: string; remaining: number }> = [];
    for (const sale of pending) {
      const { data, error } = await admin.rpc("apply_ebay_paid_order", {
        p_user_id: ownerId,
        p_product_id: product.id,
        p_order_id: sale.orderId,
        p_listing_id: sale.listingId,
        p_quantity: sale.quantity,
        p_line_item_ids: sale.lineItemIds,
      });
      if (error || !data || typeof data !== "object") {
        throw new Error(`Database order apply uncertain: ${error?.message ?? "No result"}. Recheck tracking records before retry.`);
      }
      const decision = data as { result?: string; remaining?: number; priorStatus?: string };
      applied.push({ orderId: sale.orderId,
        result: String(decision.result ?? "unknown"), remaining: Number(decision.remaining) });
      if (decision.result === "oversold" || decision.result === "conflict" ||
          (decision.result === "duplicate" && decision.priorStatus === "oversold")) {
        return Response.json({ success: false, action: "manual-review", applied,
          note: "Order over available stock or conflict. Previous applications are not rolled back." }, { status: 409 });
      }
      if (decision.result !== "applied" && decision.result !== "duplicate") {
        throw new Error("Unexpected result applying eBay order; stop and review.");
      }
    }
    return Response.json({ success: true, action: applied.length ? "orders-imported" : "no-new-orders",
      sku, ordersImported: applied.filter(x => x.result === "applied").length,
      alreadyImported: parsed.sales.length - pending.length,
      processed: applied, note: "Central inventory changed, if applicable. Existing outbound eBay worker runs afterward; Bonanza is NOT updated." });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown";
    console.error("eBay order import worker:", detail);
    return Response.json({ success: false, action: "error", error: detail,
      note: "No blind retries; check central and eBay order tracking records." }, { status: 502 });
  } finally {
    running = false;
  }
}
