import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductionEbayAccessToken } from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";

type RemoteResult = {
  exists: boolean;
  status: number;
  body: Record<string, unknown> | null;
};

// Read-only eBay inspection. Treat unexpected API errors as failures, NEVER as missing SKUs.
async function ebayRead(url: string, token: string): Promise<RemoteResult> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
    cache: "no-store",
  });

  if (res.status === 404) return { exists: false, status: 404, body: null };
  // Some eBay Inventory API endpoints use 400 with a specific "not found" code.
  // Distinguish that from all other 400 errors, which must halt publishing.
  if (res.status === 400) {
    const errorBody: unknown = await res.json().catch(() => null);
    const errors = errorBody && typeof errorBody === "object"
      ? (errorBody as Record<string, unknown>).errors
      : null;
    const codes = Array.isArray(errors)
      ? errors.map((e) => e && typeof e === "object" ? String((e as Record<string, unknown>).errorId ?? "") : "")
      : [];
    if (codes.length && codes.every((c) => c === "25702" || c === "25710")) {
      return { exists: false, status: 400, body: null };
    }
    throw new Error("eBay returned a non-'not-found' HTTP 400. Check authentication and SKU before publishing.");
  }
  if (!res.ok) throw new Error(`eBay read-only request returned HTTP ${res.status}.`);

  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Unexpected eBay response format.");
  }
  return { exists: true, status: res.status, body: body as Record<string, unknown> };
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const url = new URL(request.url);
    const sku = (url.searchParams.get("sku") ?? "").trim();
    if (!sku || sku.length > 50) {
      return Response.json({ error: "Supply a valid SKU (up to 50 characters)." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: "Log into ListNexus first." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: product, error: productError } = await admin
      .from("products")
      .select("id,sku,title,quantity,status")
      .eq("user_id", user.id)
      .eq("sku", sku)
      .maybeSingle();
    if (productError) throw new Error("Unable to load the central product.");
    if (!product) return Response.json({ error: "SKU does not belong to this ListNexus user." }, { status: 404 });

    const [{ data: mappings, error: mappingError }, { data: drafts, error: draftError }] = await Promise.all([
      admin.from("marketplace_listings")
        .select("id,status,external_listing_id,external_offer_id,quantity")
        .eq("product_id", product.id)
        .eq("marketplace", "EBAY")
        .eq("environment", "PRODUCTION"),
      admin.from("listing_drafts")
        .select("id,status,generated_title,suggested_price")
        .eq("product_id", product.id)
        .eq("user_id", user.id),
    ]);
    if (mappingError || draftError) throw new Error("Unable to read listing mappings or drafts.");

    // This helper may refresh the cached eBay OAuth access token in Supabase.
    const token = await getProductionEbayAccessToken(user.id);
    const base = "https://api.ebay.com/sell/inventory/v1";
    const [inventoryResponse, offersResponse] = await Promise.all([
      ebayRead(`${base}/inventory_item/${encodeURIComponent(sku)}`, token),
      ebayRead(`${base}/offer?sku=${encodeURIComponent(sku)}`, token),
    ]);

    const offers = offersResponse.body?.offers;
    if (offersResponse.exists && !Array.isArray(offers)) {
      throw new Error("Unexpected eBay offers response; do not publish until reviewed.");
    }

    const remoteOffers = (Array.isArray(offers) ? offers : []).map((raw) => {
      const offer = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      return {
        offerId: offer.offerId ?? null,
        listingId: offer.listingId ?? (offer.listing && typeof offer.listing === "object" ? (offer.listing as Record<string, unknown>).listingId ?? null : null),
        status: offer.status ?? null,
        availableQuantity: offer.availableQuantity ?? null,
      };
    });

    const remoteItem = inventoryResponse.body;
    const itemAvailability = remoteItem?.availability;
    const shipToLocationAvailability = itemAvailability && typeof itemAvailability === "object"
      ? (itemAvailability as Record<string, unknown>).shipToLocationAvailability
      : null;
    const inventoryItemQuantity = shipToLocationAvailability && typeof shipToLocationAvailability === "object"
      ? (shipToLocationAvailability as Record<string, unknown>).quantity ?? null
      : null;

    const approvedDrafts = (drafts ?? []).filter((draft) => draft.status === "APPROVED");
    const safeNewSku = !inventoryResponse.exists && remoteOffers.length === 0 && (mappings ?? []).length === 0 && product.status === "AVAILABLE" && Number(product.quantity) > 0;

    return Response.json({
      success: true,
      mode: "read-only-production-preflight",
      product: { sku: product.sku, title: product.title, centralQuantity: product.quantity, status: product.status },
      localProductionMappings: mappings ?? [],
      drafts: drafts ?? [],
      approvedDrafts: approvedDrafts.length,
      ebay: {
        inventoryItemExists: inventoryResponse.exists,
        inventoryItemQuantity,
        offers: remoteOffers,
      },
      clearForNewSku: safeNewSku,
      nextStep: !safeNewSku
        ? "STOP: A local mapping/eBay SKU or offer exists, or central product is unavailable/out of stock. Review before publishing; the current publish route PUT may replace existing inventory."
        : approvedDrafts.length === 0
          ? "SKU is clear. Create and approve an eBay-specific listing draft before publishing."
          : "SKU is clear. Review a seller-approved eBay draft, actual physical stock and shipping terms before publishing.",
      warning: "A published Production offer is a real listing. The current publish route lists product.quantity units and uses the approved draft suggested_price. Automated cross-marketplace stock synchronization is NOT enabled.",
      marketplaceChanges: false,
      inventoryChanges: false,
    });
  } catch (error) {
    console.error("eBay Production new-SKU preflight:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({
      success: false,
      error: "Production new-SKU preflight failed. Do not publish until resolved.",
      detail: error instanceof Error ? error.message : undefined,
      marketplaceChanges: false,
      inventoryChanges: false,
    }, { status: 502 });
  }
}
