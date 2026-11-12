import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductionEbayAccessToken } from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InventoryItem = {
  sku?: string;
  availability?: {
    shipToLocationAvailability?: { quantity?: number | string | null };
  };
};

type EbayOffer = {
  sku?: string;
  offerId?: string;
  availableQuantity?: number | string | null;
  status?: string;
  listingId?: string;
  listing?: { listingId?: string; status?: string };
};

function nonnegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function readEbay<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.ebay.com/sell/inventory/v1/${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  // Do not expose eBay's raw response: it may contain account details.
  if (!response.ok) {
    throw new Error(`eBay ${path.startsWith("offer/") ? "offer" : "inventory item"} lookup failed (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function GET(request: Request) {
  // Deliberately restrict this debugging endpoint to local development.
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: "Sign in to ListNexus first." }, { status: 401 });
    }

    const sku = new URL(request.url).searchParams.get("sku")?.trim() ?? "";
    if (!sku || sku.length > 50 || /[\u0000-\u001F\u007F]/.test(sku)) {
      return Response.json({ error: "Provide a valid SKU (up to 50 characters)." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: products, error: productError } = await admin
      .from("products")
      .select("id,sku,title,quantity,status")
      .eq("user_id", user.id)
      .eq("sku", sku)
      .limit(2);
    if (productError) throw new Error("Unable to read central inventory.");
    if (!products?.length) return Response.json({ error: "Product not found." }, { status: 404 });
    if (products.length !== 1) {
      return Response.json({ error: "Multiple products have this SKU; resolve the ambiguity before syncing." }, { status: 409 });
    }
    const product = products[0];

    // marketplace_listings has no user_id column; ownership comes from the product.
    const { data: listings, error: listingError } = await admin
      .from("marketplace_listings")
      .select("external_offer_id,external_listing_id,quantity,status,last_synced_at")
      .eq("product_id", product.id)
      .eq("marketplace", "EBAY")
      .eq("environment", "PRODUCTION")
      .limit(2);
    if (listingError) throw new Error("Unable to read the eBay Production mapping.");
    if (!listings?.length) {
      return Response.json({
        success: true,
        mode: "read-only",
        environment: "PRODUCTION",
        product,
        linked: false,
        message: "This product has no eBay Production listing mapping; no eBay call was made.",
        ebayChanges: false,
        inventoryChanges: false,
      });
    }
    if (listings.length !== 1) {
      return Response.json({ error: "Multiple eBay Production mappings for this product. Manual review required." }, { status: 409 });
    }
    const mapping = listings[0];
    if (!mapping.external_offer_id || !mapping.external_listing_id) {
      return Response.json({ error: "The eBay Production listing mapping is missing an offer or listing ID." }, { status: 409 });
    }

    const accessToken = await getProductionEbayAccessToken(user.id);
    const [inventory, offer] = await Promise.all([
      readEbay<InventoryItem>(`inventory_item/${encodeURIComponent(sku)}`, accessToken),
      readEbay<EbayOffer>(`offer/${encodeURIComponent(String(mapping.external_offer_id))}`, accessToken),
    ]);
    const offerListingId = offer.listing?.listingId ?? offer.listingId ?? null;
    const offerId = String(mapping.external_offer_id);
    const listingId = String(mapping.external_listing_id);

    if ((inventory.sku && inventory.sku !== sku) ||
        (offer.sku && offer.sku !== sku) ||
        (offer.offerId && String(offer.offerId) !== offerId) ||
        (offerListingId && String(offerListingId) !== listingId)) {
      return Response.json({
        error: "eBay returned an SKU, offer, or listing ID that does not match the Supabase mapping. Do not synchronize until reviewed.",
      }, { status: 409 });
    }

    const inventoryQty = nonnegativeInteger(inventory.availability?.shipToLocationAvailability?.quantity);
    const offerQty = nonnegativeInteger(offer.availableQuantity);
    // eBay's listing quantity can be constrained by both inventory and offer.
    // This is an API-data estimate, not a verified buyer-facing live count.
    const estimatedListingQty = inventoryQty !== null && offerQty !== null
      ? Math.min(inventoryQty, offerQty)
      : null;
    const centralQty = nonnegativeInteger(product.quantity);

    return Response.json({
      success: true,
      mode: "read-only",
      environment: "PRODUCTION",
      product: {
        id: product.id,
        sku: product.sku,
        title: product.title,
        centralQuantity: centralQty,
        status: product.status,
      },
      mapping: {
        listingId,
        offerId,
        recordedQuantity: mapping.quantity,
        status: mapping.status,
        lastSyncedAt: mapping.last_synced_at,
      },
      ebay: {
        inventoryItemQuantity: inventoryQty,
        offerAvailableQuantity: offerQty,
        estimatedListingQuantity: estimatedListingQty,
        offerStatus: offer.status ?? null,
        offerListingId,
      },
      comparison: {
        bothRemoteQuantitiesPresent: inventoryQty !== null && offerQty !== null,
        centralMatchesEstimatedListing: estimatedListingQty === null || centralQty === null
          ? null
          : centralQty === estimatedListingQty,
        note: "An estimate from eBay inventory item and offer data, not a buyer-facing availability guarantee.",
      },
      ebayChanges: false,
      inventoryChanges: false,
      note: "This endpoint makes only GET requests to eBay. The token helper may refresh its cached access token in Supabase.",
    });
  } catch (error) {
    console.error("eBay Production inventory audit:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({
      success: false,
      error: "eBay Production inventory audit failed.",
      detail: error instanceof Error ? error.message : "Unknown error",
      ebayChanges: false,
      inventoryChanges: false,
    }, { status: 502 });
  }
}
