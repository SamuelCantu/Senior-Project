import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Read-only development audit for ONE central product. Does not use any
// marketplace tokens, send API calls, alter stock, or publish listings.
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const sku = new URL(request.url).searchParams.get("sku")?.trim();
    if (!sku || sku.length > 128) {
      return Response.json({ error: "Supply one SKU, for example ?sku=10" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: "Log into ListNexus first." }, { status: 401 });
    }

    // The service-role client must ONLY query the signed-in user's products.
    const admin = createAdminClient();
    const { data: products, error: productError } = await admin
      .from("products")
      .select("id,user_id,sku,title,quantity,status")
      .eq("user_id", user.id)
      .eq("sku", sku)
      .limit(2);
    if (productError) throw new Error(`Could not read product: ${productError.message}`);
    if (!products?.length) {
      return Response.json({ error: "No product with that SKU belongs to this account." }, { status: 404 });
    }
    if (products.length !== 1) {
      return Response.json({ error: "More than one product uses that SKU. Resolve before syncing." }, { status: 409 });
    }
    const product = products[0];
    const quantity = Number(product.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error("Invalid central inventory quantity.");
    }

    // Your team already has the eBay mapping in marketplace_listings.
    // Bonanza is in its SEPARATE bonanza_publications table.
    // These reads don't assume any eBay update endpoint implementation.
    const [ebayResult, bonanzaResult, historyResult] = await Promise.all([
      admin.from("marketplace_listings")
        .select("id,marketplace,external_listing_id,external_offer_id,status,environment,quantity")
        .eq("product_id", product.id)
        .eq("marketplace", "ebay"),
      admin.from("bonanza_publications")
        .select("id,external_item_id,status,published_at,last_sync_at")
        .eq("user_id", user.id)
        .eq("product_id", product.id)
        .eq("marketplace", "bonanza"),
      admin.from("inventory_sync_events")
        .select("id,old_quantity,new_quantity,created_at")
        .eq("user_id", user.id)
        .eq("product_id", product.id)
        .order("id", { ascending: false })
        .limit(5),
    ]);

    if (ebayResult.error) throw new Error(`eBay mapping query failed: ${ebayResult.error.message}`);
    if (bonanzaResult.error) throw new Error(`Bonanza mapping query failed: ${bonanzaResult.error.message}`);
    if (historyResult.error) throw new Error(`Inventory event query failed: ${historyResult.error.message}`);

    return Response.json({
      success: true,
      mode: "read-only-inventory-sync-audit",
      product: {
        id: product.id,
        sku: product.sku,
        title: product.title,
        centralQuantity: quantity,
        status: product.status,
      },
      ebay: (ebayResult.data ?? []).map((listing) => ({
        listingId: listing.external_listing_id,
        offerId: listing.external_offer_id,
        environment: listing.environment,
        mappingStatus: listing.status,
        storedMappingQuantity: listing.quantity,
      })),
      bonanza: (bonanzaResult.data ?? []).map((listing) => ({
        itemId: listing.external_item_id,
        mappingStatus: listing.status,
        publishedAt: listing.published_at,
        lastSyncAt: listing.last_sync_at,
      })),
      inventoryChangeHistory: historyResult.data ?? [],
      notes: [
        "No marketplace inventory has been updated.",
        "An empty change history is normal until quantity changes after the trigger was installed.",
        "Mapping quantities are database records, NOT live quantities verified with the marketplaces.",
        "The Bonanza listing should remain inactive until eBay and Bonanza order and quantity paths are verified.",
      ],
      databaseChanges: false,
      marketplaceChanges: false,
    });
  } catch (error) {
    console.error("ListNexus sync preview failed:", error instanceof Error ? error.message : error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Preview failed" },
      { status: 500 },
    );
  }
}
