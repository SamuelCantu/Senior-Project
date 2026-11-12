import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type BonanzaItem = {
  itemID?: number | string;
  title?: string;
  sku?: string;
  quantity?: number | string;
  listingStatus?: string;
};

type BonanzaResponse = {
  ack?: string;
  errorMessage?: unknown;
  getUnlistedItemResponse?: { item?: BonanzaItem };
};

export async function POST(request: Request) {
  // This is a *read-only* development integration for one seller.
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return Response.json(
      { error: "You must be logged into ListNexus." },
      { status: 401 }
    );
  }

  const testOwnerId = process.env.BONANZA_TEST_OWNER_ID?.trim();
  const devId = process.env.BONANZA_DEV_ID;
  const certId = process.env.BONANZA_CERT_ID;
  const token = process.env.BONANZA_USER_TOKEN;
  const itemId = process.env.BONANZA_TEST_ITEM_ID;

  if (!testOwnerId || !devId || !certId || !token || !itemId) {
    return Response.json(
      { error: "Bonanza test configuration is incomplete." },
      { status: 503 }
    );
  }

  console.log("=== BONANZA USER CHECK ===");
  console.log("Environment ID exists:", !!testOwnerId);
  console.log("IDs match:", user.id === testOwnerId);
  console.log("Logged-in UID last 6:", user.id.slice(-6));
  console.log("Configured UID last 6:", testOwnerId?.slice(-6));

  // Don't let other logged-in ListNexus users access this seller's token.
  if (user.id !== testOwnerId) {
    return Response.json(
      { error: "This Bonanza test account is not connected to your user." },
      { status: 403 }
    );
  }

  if (!/^\d+$/.test(itemId)) {
    return Response.json(
      { error: "Invalid Bonanza test item ID." },
      { status: 503 }
    );
  }

  let draftId: string;
  try {
    const body: unknown = await request.json();
    const providedId =
      typeof body === "object" && body !== null && "draftId" in body
        ? (body as { draftId?: unknown }).draftId
        : undefined;
    draftId = typeof providedId === "string" ? providedId.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  if (!draftId || draftId.length > 100) {
    return Response.json({ error: "Missing or invalid draftId." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data: draft, error: draftError } = await admin
      .from("listing_drafts")
      .select("id,product_id,user_id,generated_title,generated_description,generated_category,generated_condition,generated_attributes,suggested_price,status")
      .eq("id", draftId)
      .eq("user_id", user.id)
      .single();

    if (draftError || !draft) {
      return Response.json({ error: "Your listing draft was not found." }, { status: 404 });
    }
    if (draft.status !== "APPROVED") {
      return Response.json({ error: "Approve the AI draft first." }, { status: 400 });
    }

    const { data: product, error: productError } = await admin
      .from("products")
      .select("id,sku,quantity,status,price")
      .eq("id", draft.product_id)
      .eq("user_id", user.id)
      .single();

    if (productError || !product) {
      return Response.json({ error: "Central product not found." }, { status: 404 });
    }
    if (product.status !== "AVAILABLE" || Number(product.quantity) <= 0) {
      return Response.json({ error: "Central product is not available." }, { status: 400 });
    }

    const { data: images, error: imagesError } = await admin
      .from("product_images")
      .select("image_url,sort_order,is_primary")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });

    if (imagesError || !images?.length) {
      return Response.json({ error: "A stored product image is required." }, { status: 400 });
    }

    // Read the existing, intentionally incomplete item. No revision is made.
    const form = new URLSearchParams({
      getUnlistedItemRequest: JSON.stringify({
        requesterCredentials: { bonanzleAuthToken: token },
        itemId,
      }),
    });

    const remoteResponse = await fetch(
      "https://api.bonanza.com/api_requests/secure_request",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-BONANZLE-API-DEV-NAME": devId,
          "X-BONANZLE-API-CERT-NAME": certId,
        },
        body: form.toString(),
        cache: "no-store",
      }
    );

    let remote: BonanzaResponse;
    try {
      remote = (await remoteResponse.json()) as BonanzaResponse;
    } catch {
      return Response.json({ error: "Bonanza returned an unreadable response." }, { status: 502 });
    }

    if (!remoteResponse.ok || remote.ack !== "Success" || !remote.getUnlistedItemResponse?.item) {
      return Response.json({ error: "Could not verify the existing Bonanza item." }, { status: 502 });
    }

    const bonanzaItem = remote.getUnlistedItemResponse.item;
    if (String(bonanzaItem.itemID) !== itemId || String(bonanzaItem.sku ?? "") !== String(product.sku)) {
      return Response.json({ error: "Bonanza item ID or SKU does not match this product." }, { status: 409 });
    }

    if (bonanzaItem.listingStatus !== "Missing required fields" || Number(bonanzaItem.quantity) !== 0) {
      return Response.json({ error: "The Bonanza item is no longer in the expected inactive test state." }, { status: 409 });
    }

    const price = Number(draft.suggested_price);
    if (!draft.generated_title?.trim() || !draft.generated_description?.trim() || !Number.isFinite(price) || price <= 0) {
      return Response.json({ error: "Approved draft has incomplete listing details." }, { status: 400 });
    }

    return Response.json({
      success: true,
      safeReadOnly: true,
      message: "Approved draft and existing inactive Bonanza item verified. Nothing was changed.",
      bonanza: {
        itemId,
        currentStatus: bonanzaItem.listingStatus,
        currentQuantity: Number(bonanzaItem.quantity),
        categoryId: 83889,
      },
      preview: {
        draftId: draft.id,
        productId: product.id,
        sku: product.sku,
        title: draft.generated_title,
        description: draft.generated_description,
        aiCategory: draft.generated_category,
        condition: draft.generated_condition,
        attributes: draft.generated_attributes ?? [],
        proposedPrice: price,
        centralQuantity: Number(product.quantity),
        images: images
          .slice()
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
          .slice(0, 4)
          .map((i) => i.image_url),
      },
    });
  } catch (error) {
    console.error("Bonanza preparation failed:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Bonanza preparation failed." }, { status: 500 });
  }
}
