import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Local integration for ONE specified seller and ONE incomplete Bonanza item.
// Do not deploy this route for multi-user use. Never accept an item ID, price,
// quantity, or credentials from the browser as the source of truth.
const BONANZA_ENDPOINT = "https://api.bonanza.com/api_requests/secure_request";
const TEST_CATEGORY_ID = 83889; // Crafts > Handcrafted & Finished Pieces > Beaded Items
const INACTIVE = "Missing required fields";

type Item = {
  itemID?: string | number;
  sku?: string;
  title?: string;
  description?: string;
  currentPrice?: number | string;
  quantity?: number | string;
  listingStatus?: string;
  primaryCategory?: { categoryId?: string | number };
};

type ApiResult = {
  ack?: string;
  errorMessage?: unknown;
  getUnlistedItemResponse?: { item?: Item };
  reviseFixedPriceItemResponse?: {
    itemId?: number | string;
    categoryId?: number | string;
    sellingState?: string;
    message?: unknown;
  };
};

type Credentials = {
  devId: string;
  certId: string;
  token: string;
};

async function callBonanza(
  method: "getUnlistedItemRequest" | "reviseFixedPriceItemRequest",
  args: Record<string, unknown>,
  credentials: Credentials
): Promise<ApiResult> {
  const form = new URLSearchParams({
    [method]: JSON.stringify({
      requesterCredentials: { bonanzleAuthToken: credentials.token },
      ...args,
    }),
  });

  const response = await fetch(BONANZA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-BONANZLE-API-DEV-NAME": credentials.devId,
      "X-BONANZLE-API-CERT-NAME": credentials.certId,
    },
    body: form.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });

  let data: ApiResult;
  try {
    data = (await response.json()) as ApiResult;
  } catch {
    throw new Error(`Bonanza returned non-JSON data (HTTP ${response.status}).`);
  }
  if (!response.ok || data.ack !== "Success") {
    // Don't log/return the unfiltered Bonanza response: it can include details
    // we don't want exposed to the browser or logs.
    throw new Error(`Bonanza ${method} failed (HTTP ${response.status}).`);
  }
  return data;
}

async function readUnlistedItem(
  itemId: string,
  credentials: Credentials
): Promise<Item> {
  const data = await callBonanza(
    "getUnlistedItemRequest",
    { itemId },
    credentials
  );
  const item = data.getUnlistedItemResponse?.item;
  if (!item) throw new Error("Bonanza did not return the unlisted item.");
  return item;
}

function matchesInactiveItem(item: Item, itemId: string, sku: string): boolean {
  return (
    String(item.itemID) === itemId &&
    String(item.sku ?? "") === sku &&
    item.listingStatus === INACTIVE &&
    Number(item.quantity) === 0 &&
    (item.primaryCategory?.categoryId == null ||
      Number(item.primaryCategory.categoryId) === TEST_CATEGORY_ID)
  );
}

function safeSupabaseImageUrls(
  images: Array<{ image_url: string; sort_order: number; is_primary: boolean }>
): string[] {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  const supabaseOrigin = new URL(base).origin;

  return images
    .slice()
    .sort(
      (a, b) =>
        Number(b.is_primary) - Number(a.is_primary) ||
        Number(a.sort_order) - Number(b.sort_order)
    )
    .slice(0, 4)
    .map((image) => {
      const url = new URL(image.image_url);
      // Bonanza fetches these directly. Only public URLs from our own
      // Supabase product-images bucket are accepted in this test.
      if (
        url.protocol !== "https:" ||
        url.origin !== supabaseOrigin ||
        !url.pathname.includes("/storage/v1/object/public/product-images/")
      ) {
        throw new Error("Product photos must use public Supabase product-images URLs.");
      }
      return url.toString();
    });
}

function getSpecifics(
  condition: string,
  attributes: Array<{ name?: string; value?: string }>
): string[][] {
  const result: string[][] = [];
  const normalized = condition.trim().toLowerCase();
  if (/\bpre-owned\b|\bused\b/.test(normalized)) {
    result.push(["Condition", "Used"]);
  } else if (/\bnew\b|\bunused\b/.test(normalized)) {
    result.push(["Condition", "New"]);
  }
  // Only map known traits with exact supported values; arbitrary AI
  // attributes are not automatically valid Bonanza traits.
  const handmade = attributes.find(
    (a) => a.name?.trim().toLowerCase() === "handmade"
  );
  if (handmade && /^(yes|no)$/i.test(handmade.value?.trim() ?? "")) {
    result.push(["Handmade", handmade.value!.trim().toLowerCase() === "yes" ? "Yes" : "No"]);
  }
  return result;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // Explicit server-side switch. A mistaken button click alone cannot write.
  if (process.env.BONANZA_ENABLE_INACTIVE_REVISE !== "true") {
    return Response.json(
      { error: "Inactive Bonanza revisions are disabled. Set BONANZA_ENABLE_INACTIVE_REVISE=true in .env.local to enable this one-item test." },
      { status: 403 }
    );
  }

  const ownerId = process.env.BONANZA_TEST_OWNER_ID?.trim();
  const itemId = process.env.BONANZA_TEST_ITEM_ID?.trim();
  const devId = process.env.BONANZA_DEV_ID;
  const certId = process.env.BONANZA_CERT_ID;
  const token = process.env.BONANZA_USER_TOKEN;
  if (!ownerId || !itemId || !/^\d+$/.test(itemId) || !devId || !certId || !token) {
    return Response.json({ error: "Bonanza test configuration is incomplete." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return Response.json({ error: "Log into ListNexus first." }, { status: 401 });
  }
  if (user.id !== ownerId) {
    return Response.json({ error: "This test Bonanza account isn't linked to your ListNexus user." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const draftId = typeof input.draftId === "string" ? input.draftId.trim() : "";
  if (
    !draftId || draftId.length > 100 ||
    input.expectedItemId !== itemId ||
    input.confirmInactiveUpdate !== true
  ) {
    return Response.json({ error: "Draft ID, test item ID, or explicit confirmation is missing." }, { status: 400 });
  }

  const credentials = { devId, certId, token };
  let revisionStarted = false;
  try {
    const admin = createAdminClient();
    const { data: draft, error: draftError } = await admin
      .from("listing_drafts")
      .select("id,product_id,user_id,generated_title,generated_description,generated_condition,generated_attributes,suggested_price,status")
      .eq("id", draftId)
      .eq("user_id", user.id)
      .single();
    if (draftError || !draft) {
      return Response.json({ error: "Listing draft not found." }, { status: 404 });
    }
    if (draft.status !== "APPROVED") {
      return Response.json({ error: "Only approved AI drafts can be sent to Bonanza." }, { status: 400 });
    }

    const { data: product, error: productError } = await admin
      .from("products")
      .select("id,user_id,sku,quantity,status")
      .eq("id", draft.product_id)
      .eq("user_id", user.id)
      .single();
    if (productError || !product) {
      return Response.json({ error: "Central product not found." }, { status: 404 });
    }
    if (product.status !== "AVAILABLE" || Number(product.quantity) <= 0) {
      return Response.json({ error: "Central product isn't available." }, { status: 400 });
    }

    const { data: images, error: imagesError } = await admin
      .from("product_images")
      .select("image_url,sort_order,is_primary")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    if (imagesError || !images?.length) {
      return Response.json({ error: "Product images are missing." }, { status: 400 });
    }

    const title = String(draft.generated_title ?? "").trim();
    const description = String(draft.generated_description ?? "").trim();
    const price = Number(draft.suggested_price);
    const sku = String(product.sku ?? "").trim();
    if (
      !title || title.length > 80 || !description || description.length > 60000 ||
      !Number.isFinite(price) || price <= 0 || !sku
    ) {
      return Response.json({ error: "Draft title, description, price or SKU is invalid for Bonanza." }, { status: 400 });
    }

    const imageUrls = safeSupabaseImageUrls(images);
    const attributes: Array<{ name?: string; value?: string }> = Array.isArray(draft.generated_attributes)
      ? draft.generated_attributes
      : [];

    // Verify exact seller item, ownership via token, SKU, category and inactive state.
    const before = await readUnlistedItem(itemId, credentials);
    if (!matchesInactiveItem(before, itemId, sku)) {
      return Response.json({ error: "Bonanza test item has changed, or ID/SKU/category does not match. Revision canceled." }, { status: 409 });
    }

    const requestItem = {
      title,
      description,
      price,
      sku,
      primaryCategory: { categoryId: TEST_CATEGORY_ID },
      itemSpecifics: { specifics: getSpecifics(String(draft.generated_condition ?? ""), attributes), discardOld: true },
      pictureDetails: { pictureURL: imageUrls, discardOld: true },
      quantity: 0,       // IMPORTANT: never copy the 20 available sets here.
      allowForSale: false,
      obo: false,
      // No shipping or booth activation call is made in this test.
    };

    revisionStarted = true;
    const revised = await callBonanza(
      "reviseFixedPriceItemRequest",
      { itemId: Number(itemId), item: requestItem },
      credentials
    );
    const result = revised.reviseFixedPriceItemResponse;
    if (!result || String(result.itemId) !== itemId || result.sellingState !== INACTIVE) {
      return Response.json(
        {
          error: "Bonanza accepted the request but did not confirm the expected inactive state. Inspect the booth immediately; do not retry blindly.",
          checkBooth: true,
          returnedStatus: result?.sellingState ?? "Unknown",
        },
        { status: 502 }
      );
    }

    // Read-after-write is necessary: status from the write response alone
    // does not prove quantity remained zero in the saved record.
    const after = await readUnlistedItem(itemId, credentials);
    if (!matchesInactiveItem(after, itemId, sku)) {
      return Response.json(
        { error: "Item revised, but a follow-up read did not confirm its inactive status. Check the Bonanza booth immediately.", checkBooth: true },
        { status: 502 }
      );
    }

    return Response.json({
      success: true,
      updated: true,
      published: false,
      itemId,
      status: after.listingStatus,
      quantity: Number(after.quantity),
      title: after.title ?? title,
      price: Number(after.currentPrice ?? price),
      imagesSubmitted: imageUrls.length,
      message: "Bonanza item updated and verified as incomplete with quantity 0. It is not available for sale.",
    });
  } catch (error) {
    console.error("Bonanza inactive revision failed:", error instanceof Error ? error.message : "Unknown error");
    return Response.json(
      {
        error: revisionStarted
          ? "Bonanza revision may have been applied, but verification failed. Inspect the booth before retrying."
          : error instanceof Error
            ? error.message
            : "Could not prepare Bonanza revision.",
        checkBooth: revisionStarted,
      },
      { status: 502 }
    );
  }
}