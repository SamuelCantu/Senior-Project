import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductionEbayAccessToken } from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual developer test. This route never modifies Supabase products.quantity.
// A POST can ONLY reduce an existing, uniquely linked live eBay Production offer.
const BASE = "https://api.ebay.com/sell/inventory/v1";
const ENVIRONMENT = "PRODUCTION";

type Item = {
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
type UpdateResult = {
  responses?: Array<{
    sku?: string;
    offerId?: string;
    statusCode?: number;
    errors?: unknown[];
    warnings?: unknown[];
  }>;
};

type State = Awaited<ReturnType<typeof loadState>>;

function qty(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function validSku(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 50 &&
    !/[\u0000-\u001F\u007F]/.test(value);
}

async function userId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user ? null : user.id;
}

async function ebayGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`eBay inventory lookup failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

async function loadState(ownerId: string, sku: string) {
  const admin = createAdminClient();
  const { data: products, error: productError } = await admin.from("products")
    .select("id,sku,title,quantity,status")
    .eq("user_id", ownerId).eq("sku", sku).limit(2);
  if (productError) throw new Error("Cannot read central product.");
  if (!products?.length) throw new Error("No central product has this SKU.");
  if (products.length !== 1) throw new Error("Duplicate SKU in central inventory.");
  const product = products[0];
  const central = qty(product.quantity);
  if (central === null) throw new Error("Central quantity is invalid.");

  // Our existing marketplace_listings schema has no user_id column.
  // Product ownership is checked above, before using the admin client here.
  const { data: mappings, error: mapError } = await admin.from("marketplace_listings")
    .select("id,product_id,external_offer_id,external_listing_id,quantity,status,last_synced_at")
    .eq("product_id", product.id).eq("marketplace", "EBAY")
    .eq("environment", ENVIRONMENT).limit(2);
  if (mapError) throw new Error("Cannot read Production listing mapping.");
  if (!mappings?.length) throw new Error("No Production listing is linked to this product.");
  if (mappings.length !== 1) throw new Error("More than one Production listing mapping exists.");
  const mapping = mappings[0];
  if (!mapping.external_offer_id || !mapping.external_listing_id) {
    throw new Error("Production mapping does not contain both offer and listing IDs.");
  }
  const offerId = String(mapping.external_offer_id);
  const listingId = String(mapping.external_listing_id);
  const token = await getProductionEbayAccessToken(ownerId);
  const [item, offer, allOffers] = await Promise.all([
    ebayGet<Item>(`inventory_item/${encodeURIComponent(sku)}`, token),
    ebayGet<Offer>(`offer/${encodeURIComponent(offerId)}`, token),
    ebayGet<Offers>(`offer?sku=${encodeURIComponent(sku)}`, token),
  ]);

  const remoteListingId = offer.listing?.listingId ?? offer.listingId;
  if (item.sku !== sku || offer.sku !== sku || String(offer.offerId ?? "") !== offerId ||
      String(remoteListingId ?? "") !== listingId) {
    throw new Error("Remote SKU, offer ID, or listing ID does not match our mapping.");
  }
  const offers = allOffers.offers;
  const onlyMappedOffer = Array.isArray(offers) && offers.length === 1 &&
    (allOffers.total == null || Number(allOffers.total) === 1) &&
    String(offers[0]?.offerId ?? "") === offerId && offers[0]?.sku === sku;
  const remoteItem = qty(item.availability?.shipToLocationAvailability?.quantity);
  const remoteOffer = qty(offer.availableQuantity);
  const recorded = qty(mapping.quantity);
  const eligible = product.status === "AVAILABLE" && mapping.status === "ACTIVE" &&
    offer.status === "PUBLISHED" && onlyMappedOffer && remoteItem !== null &&
    remoteOffer !== null && recorded !== null &&
    remoteItem === remoteOffer && remoteItem === recorded && central <= remoteItem;

  return {
    admin, token, sku, product, mapping, central, offerId, listingId,
    remoteItem, remoteOffer, recorded, onlyMappedOffer,
    offerStatus: offer.status ?? null, eligible,
  };
}

function preview(state: State) {
  return {
    environment: ENVIRONMENT,
    product: { sku: state.sku, title: state.product.title,
      centralQuantity: state.central, status: state.product.status },
    mapping: { listingId: state.listingId, offerId: state.offerId,
      recordedQuantity: state.recorded, status: state.mapping.status },
    ebay: { inventoryItemQuantity: state.remoteItem,
      offerAvailableQuantity: state.remoteOffer, offerStatus: state.offerStatus,
      onlyMappedOfferForSku: state.onlyMappedOffer },
    comparison: {
      fullyMatched: state.remoteItem === state.central && state.remoteOffer === state.central,
      eligibleForDecrease: state.eligible && state.remoteItem !== state.central,
      note: state.eligible
        ? "Unique published listing verified. If central stock is lower, a controlled decrease could be sent."
        : "Write BLOCKED: requires ACTIVE mapping, one PUBLISHED offer, both eBay quantities equal the recorded mapping, and central stock no higher than eBay.",
    },
    proposedUpdate: {
      requests: [{ sku: state.sku,
        shipToLocationAvailability: { quantity: state.central },
        offers: [{ offerId: state.offerId, availableQuantity: state.central }] }],
    },
  };
}

// Safe GET: only fetches Supabase/eBay and performs no marketplace update.
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const ownerId = await userId();
  if (!ownerId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const sku = new URL(request.url).searchParams.get("sku");
  if (!validSku(sku)) return Response.json({ error: "Invalid SKU." }, { status: 400 });
  try {
    const state = await loadState(ownerId, sku);
    return Response.json({ success: true, mode: "read-only", ...preview(state),
      marketplaceChanges: false, inventoryChanges: false,
      note: "No quantity changes. The authentication helper may refresh its token cache in Supabase." });
  } catch (error) {
    console.error("Production quantity-sync preview:", error instanceof Error ? error.message : "unknown");
    return Response.json({ success: false, error: error instanceof Error ? error.message : "Preview failed." }, { status: 502 });
  }
}

// Manual guarded POST. Disabled by default, cannot increase stock, never changes product quantity.
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (process.env.EBAY_ENABLE_PRODUCTION_QUANTITY_PUSH !== "true") {
    return Response.json({ error: "Production quantity writes are disabled." }, { status: 403 });
  }
  const ownerId = await userId();
  if (!ownerId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Unexpected request origin." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const sku = body.sku;
  if (!validSku(sku) || sku !== process.env.EBAY_PRODUCTION_QUANTITY_TEST_SKU ||
      body.confirmation !== `REDUCE EBAY PRODUCTION ${sku}`) {
    return Response.json({ error: "SKU does not match configured test SKU, or confirmation is missing." }, { status: 400 });
  }
  try {
    const state = await loadState(ownerId, sku);
    if (body.expectedQuantity !== state.central ||
        body.expectedRemoteQuantity !== state.remoteItem ||
        body.expectedOfferId !== state.offerId ||
        body.expectedListingId !== state.listingId) {
      return Response.json({ error: "Values changed or do not match preview. Fetch a new preview.",
        ...preview(state) }, { status: 409 });
    }
    if (!state.eligible) {
      return Response.json({ error: "The listing state is not safe for a controlled reduction. Reconcile first.",
        ...preview(state) }, { status: 409 });
    }
    if (state.central === state.remoteItem && state.central === state.remoteOffer) {
      return Response.json({ success: true, action: "no-op", ...preview(state),
        marketplaceChanges: false, inventoryChanges: false });
    }
    // Only reduce; never replenish a listing that could have unprocessed eBay sales.
    if (state.remoteItem === null || state.remoteOffer === null ||
        state.central >= state.remoteItem) {
      return Response.json({ error: "Only a decrease in both eBay quantities is allowed." }, { status: 409 });
    }

    // A last central read avoids sending an already-stale target. A sale can still
    // race with an external API call; this route is NOT automatic oversell prevention.
    const { data: latest, error: latestError } = await state.admin.from("products")
      .select("quantity,status").eq("id", state.product.id).eq("user_id", ownerId).single();
    if (latestError || !latest || qty(latest.quantity) !== state.central ||
        latest.status !== state.product.status) {
      return Response.json({ error: "Central inventory changed. Start with a new preview." }, { status: 409 });
    }

    const response = await fetch(`${BASE}/bulk_update_price_quantity`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Content-Language": "en-US",
        "Accept-Language": "en-US",
      },
      body: JSON.stringify(preview(state).proposedUpdate),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const result = (await response.json().catch(() => ({}))) as UpdateResult;
    const statuses = Array.isArray(result.responses) ? result.responses : [];
    const passed = response.ok && statuses.length > 0 && statuses.every(r =>
      r.statusCode === 200 && (r.sku == null || r.sku === sku) &&
      (r.offerId == null || String(r.offerId) === state.offerId) &&
      !(r.errors?.length));
    if (!passed) {
      return Response.json({
        success: false,
        error: "eBay update rejected or uncertain. Inspect live quantities before retrying.",
        httpStatus: response.status,
        statuses: statuses.map(s => ({ sku: s.sku, offerId: s.offerId, statusCode: s.statusCode })),
        outcomeUncertain: true,
      }, { status: 409 });
    }

    const [item, offer] = await Promise.all([
      ebayGet<Item>(`inventory_item/${encodeURIComponent(sku)}`, state.token),
      ebayGet<Offer>(`offer/${encodeURIComponent(state.offerId)}`, state.token),
    ]);
    const itemNow = qty(item.availability?.shipToLocationAvailability?.quantity);
    const offerNow = qty(offer.availableQuantity);
    if (itemNow !== state.central || offerNow !== state.central) {
      return Response.json({ success: false, error: "eBay accepted the update but readback does not match; reconcile manually.",
        inventoryNow: itemNow, offerNow, target: state.central, outcomeUncertain: true }, { status: 409 });
    }
    const { data: after, error: afterError } = await state.admin.from("products")
      .select("quantity").eq("id", state.product.id).eq("user_id", ownerId).single();
    if (afterError || !after || qty(after.quantity) !== state.central) {
      return Response.json({ success: false,
        error: "eBay was updated, but central quantity changed during synchronization. Reconcile manually.",
        verifiedEbayQuantity: state.central }, { status: 409 });
    }

    const { error: saveError } = await state.admin.from("marketplace_listings")
      .update({ quantity: state.central, last_synced_at: new Date().toISOString() })
      .eq("id", state.mapping.id).eq("product_id", state.product.id)
      .eq("marketplace", "EBAY").eq("environment", ENVIRONMENT);
    if (saveError) {
      return Response.json({ success: false,
        error: "eBay updated successfully, but saving the local mapping failed. Reconcile manually.",
        verifiedEbayQuantity: state.central }, { status: 409 });
    }

    return Response.json({ success: true, action: "reduced", environment: ENVIRONMENT,
      sku, listingId: state.listingId, quantity: state.central,
      verified: { inventoryItemQuantity: itemNow, offerAvailableQuantity: offerNow },
      marketplaceChanges: true, mappingUpdated: true, inventoryChanges: false,
      note: "Manual eBay Production reduction completed. Bonanza and order syncing are not automated." });
  } catch (error) {
    console.error("Production quantity-sync POST:", error instanceof Error ? error.message : "unknown");
    return Response.json({ success: false,
      error: "Production update failed or its outcome is unknown. Read live eBay inventory before retrying.",
      outcomeUncertain: true }, { status: 502 });
  }
}
