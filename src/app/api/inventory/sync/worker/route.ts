import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductionEbayAccessToken } from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EBAY_BASE = "https://api.ebay.com/sell/inventory/v1";
const ENVIRONMENT = "PRODUCTION";

// Local senior-project worker: one SKU / account, decrease-only, authenticated
// with a server-side secret. NOT a full marketplace-order reconciliation system.
let running = false;

type InventoryItem = {
  sku?: string;
  availability?: { shipToLocationAvailability?: { quantity?: number | string | null } };
};
type Offer = {
  sku?: string;
  offerId?: string;
  availableQuantity?: number | string | null;
  status?: string;
  listingId?: string;
  listing?: { listingId?: string };
};
type Offers = { offers?: Offer[]; total?: number };
type BulkResult = {
  responses?: Array<{
    sku?: string;
    offerId?: string;
    statusCode?: number;
    errors?: unknown[];
  }>;
};

function nonnegativeInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function secretMatches(supplied: string | null): boolean {
  const expected = process.env.INVENTORY_SYNC_WORKER_SECRET;
  if (!expected || expected.length < 32 || !supplied) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ebayGet<T>(path: string, token: string): Promise<T> {
  const result = await fetch(`${EBAY_BASE}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok) throw new Error(`eBay read failed: HTTP ${result.status}`);
  return (await result.json()) as T;
}

async function doWork() {
  const ownerId = process.env.INVENTORY_SYNC_OWNER_ID || process.env.BONANZA_TEST_OWNER_ID;
  const sku = process.env.INVENTORY_SYNC_SKU || process.env.EBAY_PRODUCTION_QUANTITY_TEST_SKU;
  if (!ownerId || !/^[0-9a-f-]{36}$/i.test(ownerId)) {
    throw new Error("Set INVENTORY_SYNC_OWNER_ID (or BONANZA_TEST_OWNER_ID) to the signed-in seller UUID.");
  }
  if (!sku || sku.length > 50 || /[\u0000-\u001f\u007f]/.test(sku)) {
    throw new Error("Missing or invalid INVENTORY_SYNC_SKU.");
  }

  const admin = createAdminClient();
  const { data: products, error: pError } = await admin.from("products")
    .select("id,sku,user_id,title,quantity,status")
    .eq("user_id", ownerId).eq("sku", sku).limit(2);
  if (pError) throw new Error(`Cannot read product: ${pError.message}`);
  if (!products || products.length !== 1) throw new Error("Expected one central product for the locked SKU.");
  const product = products[0];
  const target = nonnegativeInt(product.quantity);
  if (target === null || !["AVAILABLE", "SOLD_OUT"].includes(String(product.status))) {
    throw new Error("Central quantity/status is not eligible for synchronization.");
  }

  const { data: mappings, error: mError } = await admin.from("marketplace_listings")
    .select("id,product_id,external_offer_id,external_listing_id,quantity,status,last_synced_at")
    .eq("product_id", product.id).eq("marketplace", "EBAY")
    .eq("environment", ENVIRONMENT).limit(2);
  if (mError) throw new Error(`Cannot read eBay mapping: ${mError.message}`);
  if (!mappings || mappings.length !== 1 || mappings[0].status !== "ACTIVE") {
    throw new Error("Expected exactly one ACTIVE eBay Production mapping.");
  }
  const mapping = mappings[0];
  const recorded = nonnegativeInt(mapping.quantity);
  const offerId = String(mapping.external_offer_id ?? "");
  const listingId = String(mapping.external_listing_id ?? "");
  if (recorded === null || !offerId || !listingId) throw new Error("Invalid saved eBay listing mapping.");
  if (target > recorded && process.env.INVENTORY_SYNC_ALLOW_INCREASE !== "true") {
    return { success: false, action: "blocked-increase-disabled", sku, target, recorded,
      note: "Set INVENTORY_SYNC_ALLOW_INCREASE=true to enable intentional restocks." };
  }

  // Inventory events act as an audit trail. Reductions must be traceable.
  if (target !== recorded) {
    const { data: events, error: eventError } = await admin.from("inventory_sync_events")
      .select("id,old_quantity,new_quantity,created_at")
      .eq("user_id", ownerId).eq("product_id", product.id)
      .order("id", { ascending: false }).limit(1);
    if (eventError) throw new Error(`Cannot read inventory event: ${eventError.message}`);
    const latest = events?.[0];
    if (!latest || nonnegativeInt(latest.new_quantity) !== target ||
        (mapping.last_synced_at && Date.parse(latest.created_at) < Date.parse(mapping.last_synced_at))) {
      return { success: false, action: "blocked-no-recent-event", sku, target, recorded,
        note: "Missing a new inventory-change event for this reduction; review the event log." };
    }
  }

  const token = await getProductionEbayAccessToken(ownerId);
  const fetchLive = () => Promise.all([
    ebayGet<InventoryItem>(`inventory_item/${encodeURIComponent(sku)}`, token),
    ebayGet<Offer>(`offer/${encodeURIComponent(offerId)}`, token),
    ebayGet<Offers>(`offer?sku=${encodeURIComponent(sku)}`, token),
  ]);
  const [item, offer, offers] = await fetchLive();
  if (item.sku !== sku || offer.sku !== sku || String(offer.offerId ?? "") !== offerId ||
      String(offer.listing?.listingId ?? offer.listingId ?? "") !== listingId ||
      offer.status !== "PUBLISHED" || !Array.isArray(offers.offers) ||
      offers.offers.length !== 1 || (offers.total != null && Number(offers.total) !== 1) ||
      String(offers.offers[0]?.offerId ?? "") !== offerId) {
    return { success: false, action: "blocked-mapping", sku,
      note: "Live eBay listing/offer differs from the saved mapping." };
  }
  const itemQty = nonnegativeInt(item.availability?.shipToLocationAvailability?.quantity);
  const offerQty = nonnegativeInt(offer.availableQuantity);
  if (itemQty === null || offerQty === null || itemQty !== offerQty) {
    return { success: false, action: "blocked-remote-mismatch", sku, itemQty, offerQty };
  }

  // Already synchronized. Also recover from a prior write that reached eBay but
  // failed to save the local mapping; no external write needed.
  if (itemQty === target) {
    if (recorded !== target) {
      const { error } = await admin.from("marketplace_listings")
        .update({ quantity: target, last_synced_at: new Date().toISOString() })
        .eq("id", mapping.id).eq("product_id", product.id)
        .eq("quantity", recorded);
      if (error) throw new Error(`eBay is correct, but mapping save failed: ${error.message}`);
      return { success: true, action: "mapping-reconciled", sku, quantity: target, marketplaceChanges: false };
    }
    return { success: true, action: "already-matched", sku, quantity: target, marketplaceChanges: false };
  }
  if (itemQty !== recorded) {
    return { success: false, action: "blocked-remote-drift", sku, target, itemQty, recorded,
      note: "Remote quantity changed independently. Reconcile sales before sending any inventory update." };
  }

  // Refresh product + live item/offer immediately before write. eBay doesn't
  // provide a cross-system atomic compare-and-set, so races can still occur.
  const { data: latest, error: latestError } = await admin.from("products")
    .select("quantity,status").eq("id", product.id).eq("user_id", ownerId).single();
  if (latestError || !latest || nonnegativeInt(latest.quantity) !== target || latest.status !== product.status) {
    return { success: false, action: "blocked-central-changed", sku };
  }
  const [secondItem, secondOffer] = await Promise.all([
    ebayGet<InventoryItem>(`inventory_item/${encodeURIComponent(sku)}`, token),
    ebayGet<Offer>(`offer/${encodeURIComponent(offerId)}`, token),
  ]);
  if (nonnegativeInt(secondItem.availability?.shipToLocationAvailability?.quantity) !== recorded ||
      nonnegativeInt(secondOffer.availableQuantity) !== recorded) {
    return { success: false, action: "blocked-remote-changed", sku };
  }

  const response = await fetch(`${EBAY_BASE}/bulk_update_price_quantity`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    },
    body: JSON.stringify({ requests: [{ sku,
      shipToLocationAvailability: { quantity: target },
      offers: [{ offerId, availableQuantity: target }],
    }] }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => ({}))) as BulkResult;
  const statuses = Array.isArray(data.responses) ? data.responses : [];
  if (!response.ok || !statuses.length || !statuses.every(r =>
    r.statusCode === 200 && (r.sku == null || r.sku === sku) &&
    (r.offerId == null || String(r.offerId) === offerId) && !(r.errors?.length))) {
    throw new Error(`eBay update response uncertain (HTTP ${response.status}); inspect live quantities before continuing.`);
  }

  const [afterItem, afterOffer] = await Promise.all([
    ebayGet<InventoryItem>(`inventory_item/${encodeURIComponent(sku)}`, token),
    ebayGet<Offer>(`offer/${encodeURIComponent(offerId)}`, token),
  ]);
  const verifiedItem = nonnegativeInt(afterItem.availability?.shipToLocationAvailability?.quantity);
  const verifiedOffer = nonnegativeInt(afterOffer.availableQuantity);
  if (verifiedItem !== target || verifiedOffer !== target) {
    throw new Error("eBay accepted update but live readback differs; do not retry blindly.");
  }
  const { error: savedError } = await admin.from("marketplace_listings")
    .update({ quantity: target, last_synced_at: new Date().toISOString() })
    .eq("id", mapping.id).eq("product_id", product.id)
    .eq("quantity", recorded);
  if (savedError) throw new Error(`eBay updated but mapping save failed: ${savedError.message}`);
  return { success: true, action: target > recorded ? "production-increased" : "production-reduced", sku, from: itemQty, to: target,
    listingId, marketplaceChanges: true, note: "Bonanza was not modified." };
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-listnexus-sync-secret"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.INVENTORY_AUTO_SYNC_ENABLED !== "true") {
    return Response.json({ success: false, action: "disabled" }, { status: 403 });
  }
  if (running) return Response.json({ success: false, action: "already-running" }, { status: 409 });
  running = true;
  try {
    const result = await doWork();
    return Response.json(result, { status: result.success ? 200 : 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Inventory sync worker:", message);
    return Response.json({ success: false, action: "error", error: message,
      note: "If eBay may have received an update, verify actual quantities before retrying." }, { status: 502 });
  } finally {
    running = false;
  }
}
