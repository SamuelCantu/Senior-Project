/** Bonanza server-only helper. Never import this module into a client component. */
import "server-only";

const ENDPOINT = "https://api.bonanza.com/api_requests/secure_request";

export type BonanzaItem = {
  itemID?: string | number;
  sku?: string;
  title?: string;
  currentPrice?: string | number;
  quantity?: string | number;
  listingStatus?: string;
  primaryCategory?: { categoryId?: string | number };
};

type ApiResponse = {
  ack?: string;
  errorMessage?: unknown;
  getUnlistedItemResponse?: { item?: BonanzaItem };
  getBoothItemsResponse?: { items?: BonanzaItem[] | BonanzaItem; totalEntries?: number };
  reviseFixedPriceItemResponse?: {
    itemId?: string | number;
    sellingState?: string;
    message?: unknown;
  };
  getOrdersResponse?: {
    hasMoreOrders?: boolean | string;
    orderArray?: { order?: unknown[] | unknown };
    paginationResult?: { totalNumberOfPages?: number };
  };
  updateInventoryResponse?: Record<string, { success?: boolean | string; message?: string }>;
};

export const BONANZA_TEST_CATEGORY = 83889;

export function testConfiguration() {
  const ownerId = process.env.BONANZA_TEST_OWNER_ID?.trim();
  const itemId = process.env.BONANZA_TEST_ITEM_ID?.trim();
  const boothId = process.env.BONANZA_BOOTH_ID?.trim();
  if (!ownerId || !itemId || !/^\d+$/.test(itemId) || !boothId) {
    throw new Error("Bonanza test owner, item, or booth is not configured.");
  }
  return { ownerId, itemId, boothId };
}

export async function bonanzaCall(
  method:
    | "getUnlistedItemRequest"
    | "getBoothItemsRequest"
    | "reviseFixedPriceItemRequest"
    | "getOrdersRequest"
    | "updateInventoryRequest",
  args: Record<string, unknown> = {}
): Promise<ApiResponse> {
  const devId = process.env.BONANZA_DEV_ID;
  const certId = process.env.BONANZA_CERT_ID;
  const token = process.env.BONANZA_USER_TOKEN;
  if (!devId || !certId || !token) throw new Error("Bonanza credentials are missing.");

  const body = new URLSearchParams({
    [method]: JSON.stringify({
      requesterCredentials: { bonanzleAuthToken: token },
      ...args,
    }),
  });
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-BONANZLE-API-DEV-NAME": devId,
      "X-BONANZLE-API-CERT-NAME": certId,
    },
    body: body.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  let json: ApiResponse;
  try {
    json = (await response.json()) as ApiResponse;
  } catch {
    throw new Error(`Bonanza returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok || json.ack !== "Success") {
    // Do not expose raw API responses/tokens to the browser.
    throw new Error(`Bonanza rejected ${method} (HTTP ${response.status}). Check server logs/booth before retrying.`);
  }
  return json;
}

export async function getUnlistedItem(itemId: string): Promise<BonanzaItem> {
  const response = await bonanzaCall("getUnlistedItemRequest", { itemId });
  const item = response.getUnlistedItemResponse?.item;
  if (!item || String(item.itemID) !== itemId) {
    throw new Error("Bonanza did not return the expected unpublished item.");
  }
  return item;
}

/** Suitable for the one-item classroom booth; fail closed if pagination grows. */
export async function getBoothItem(itemId: string, boothId: string): Promise<BonanzaItem | null> {
  const data = await bonanzaCall("getBoothItemsRequest", {
    boothId,
    itemStatus: ["for_sale", "ready_to_post", "missing_fields", "reserved", "sold"],
    itemsPerPage: 500,
    page: 1,
  });
  const result = data.getBoothItemsResponse;
  if (!result) throw new Error("Bonanza inventory response missing.");
  const values = Array.isArray(result.items) ? result.items : result.items ? [result.items] : [];
  const match = values.find((x) => String(x.itemID) === itemId);
  if (!match && Number(result.totalEntries ?? 0) > 500) {
    throw new Error("Booth has more than 500 items; implement pagination before publishing.");
  }
  return match ?? null;
}

export function publicProductImageUrls(
  images: Array<{ image_url: string; is_primary: boolean; sort_order: number }>
): string[] {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) throw new Error("Supabase project URL is missing.");
  const origin = new URL(configured).origin;
  return [...images]
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
    .slice(0, 4)
    .map((image) => {
      const url = new URL(image.image_url);
      if (url.protocol !== "https:" || url.origin !== origin ||
          !url.pathname.startsWith("/storage/v1/object/public/product-images/")) {
        throw new Error("Bonanza requires publicly accessible images in the product-images bucket.");
      }
      return url.toString();
    });
}
