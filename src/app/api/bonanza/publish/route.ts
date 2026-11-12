import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BONANZA_TEST_CATEGORY, bonanzaCall, getBoothItem,
  getUnlistedItem, publicProductImageUrls, testConfiguration,
} from "@/lib/bonanza/server";

export const runtime = "nodejs";

// Single-owner classroom integration, intentionally disabled in production.
// This is a LIVE listing endpoint, NOT a sandbox endpoint.
type ShippingInput = {
  type?: "Calculated" | "Fixed" | "Free";
  shippingCost?: unknown;
  pounds?: unknown;
  ounces?: unknown;
  shipsWithinDays?: unknown;
};

function buildShipping(input: ShippingInput) {
  const days = Number(input.shipsWithinDays);
  if (!Number.isInteger(days) || days < 1 || days > 30) {
    throw new Error("Specify a handling time of 1–30 business days.");
  }
  if (input.type === "Calculated") {
    const pounds = Number(input.pounds);
    const ounces = Number(input.ounces);
    if (!Number.isInteger(pounds) || pounds < 0 || pounds > 70 ||
        !Number.isInteger(ounces) || ounces < 0 || ounces > 15 ||
        pounds * 16 + ounces <= 0) {
      throw new Error("Enter the real packaged shipping weight in pounds and ounces.");
    }
    return {
      shipsWithinDays: days,
      calculatedShippingRate: {
        packageSize: "Normal package",
        shippingWeightLbs: pounds,
        shippingWeightOz: ounces,
      },
      shippingServiceOptions: [{ shippingType: "Calculated", shippingCarrier: "USPS" }],
    };
  }
  if (input.type === "Fixed") {
    const cost = Number(input.shippingCost);
    if (!Number.isFinite(cost) || cost <= 0 || cost > 500) {
      throw new Error("Specify a positive shipping charge; use Free for free shipping.");
    }
    return {
      shipsWithinDays: days,
      shippingServiceOptions: [{ shippingType: "Fixed", shippingServiceCost: Number(cost.toFixed(2)) }],
    };
  }
  if (input.type === "Free") {
    return {
      shipsWithinDays: days,
      shippingServiceOptions: [{ shippingType: "Free", freeShipping: true }],
    };
  }
  throw new Error("Select a shipping method.");
}

export async function POST(request: Request) {
  let publishAttempted = false;
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  if (process.env.BONANZA_ENABLE_LIVE_PUBLISH !== "true") {
    return Response.json({ error: "Live Bonanza publishing is disabled in .env.local." }, { status: 403 });
  }

  try {
    const { ownerId, itemId, boothId } = testConfiguration();
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Log in first." }, { status: 401 });
    if (user.id !== ownerId) return Response.json({ error: "Bonanza account is not linked to this user." }, { status: 403 });

    const body = (await request.json()) as Record<string, unknown>;
    const draftId = typeof body.draftId === "string" ? body.draftId.trim() : "";
    if (!draftId || body.expectedItemId !== itemId || body.confirmation !== "PUBLISH") {
      return Response.json({ error: "Expected item ID and PUBLISH confirmation are required." }, { status: 400 });
    }
    const shipping = buildShipping((body.shipping ?? {}) as ShippingInput);
    const admin = createAdminClient();

    const { data: draft } = await admin.from("listing_drafts")
      .select("id,product_id,user_id,generated_title,generated_description,generated_condition,generated_attributes,suggested_price,status")
      .eq("id", draftId).eq("user_id", user.id).single();
    if (!draft || draft.status !== "APPROVED") {
      return Response.json({ error: "The AI draft must be owned and approved." }, { status: 400 });
    }
    const { data: product } = await admin.from("products")
      .select("id,user_id,sku,quantity,status")
      .eq("id", draft.product_id).eq("user_id", user.id).single();
    if (!product || product.status !== "AVAILABLE" ||
        !Number.isInteger(product.quantity) || product.quantity <= 0) {
      return Response.json({ error: "Central product is missing or out of stock." }, { status: 400 });
    }
    const price = Number(draft.suggested_price);
    const title = String(draft.generated_title ?? "").trim();
    const description = String(draft.generated_description ?? "").trim();
    const sku = String(product.sku ?? "").trim();
    if (!title || title.length > 80 || !description || description.length > 60000 ||
        !Number.isFinite(price) || price <= 0 || !sku) {
      return Response.json({ error: "Approved title, description, price or SKU is invalid." }, { status: 400 });
    }
    if (body.expectedPrice !== price || body.expectedQuantity !== product.quantity) {
      return Response.json({ error: "Price or quantity has changed. Reload preparation before publishing." }, { status: 409 });
    }
    const { data: images } = await admin.from("product_images")
      .select("image_url,sort_order,is_primary").eq("product_id", product.id);
    if (!images?.length) return Response.json({ error: "At least one public product photo is required." }, { status: 400 });
    const photoUrls = publicProductImageUrls(images);

    // Prevent republishing a linked item or linking it to another product.
    const { data: existing, error: existingError } = await admin.from("bonanza_publications")
      .select("id,status,external_item_id")
      .eq("user_id", user.id).eq("marketplace", "bonanza")
      .or(`product_id.eq.${product.id},external_item_id.eq.${itemId}`);
    if (existingError) throw new Error("Could not read marketplace mapping. Run the SQL setup first.");
    if (existing?.length) {
      return Response.json({ error: "Item already has a marketplace mapping. Do not publish twice." }, { status: 409 });
    }

    const before = await getUnlistedItem(itemId);
    if (String(before.sku) !== sku || Number(before.quantity) !== 0 ||
        before.listingStatus !== "Missing required fields" ||
        (before.primaryCategory?.categoryId != null && Number(before.primaryCategory.categoryId) !== BONANZA_TEST_CATEGORY)) {
      return Response.json({ error: "Unlisted item, SKU, category, or inactive state changed. Publish canceled." }, { status: 409 });
    }

    // Claim the mapping BEFORE making an external write, so a repeated click
    // cannot blindly publish the same item twice.
    const { data: mapping, error: mappingError } = await admin.from("bonanza_publications")
      .insert({
        user_id: user.id, product_id: product.id, marketplace: "bonanza",
        external_item_id: itemId, status: "publishing",
      }).select("id,created_at").single();
    if (mappingError || !mapping) {
      return Response.json({ error: "Could not reserve marketplace mapping. No publish request was made." }, { status: 409 });
    }

    let writeAttempted = false;
    try {
      const condition = String(draft.generated_condition ?? "").toLowerCase();
      const specifics = [
        ["Brand", "Handmade"],
        ["Handmade", "Yes"],
        ["Bundle Listing", "Yes"],
        ["Condition", /used|pre-owned/.test(condition) ? "Used" : "New"],
      ];
      const item = {
        title, description, sku, price,
        quantity: product.quantity,
        allowForSale: true, // This WILL offer the item to real buyers.
        obo: false,
        primaryCategory: { categoryId: BONANZA_TEST_CATEGORY },
        itemSpecifics: { specifics, discardOld: true },
        pictureDetails: { pictureURL: photoUrls, discardOld: true },
        shippingDetails: shipping,
      };
      writeAttempted = true;
      publishAttempted = true;
      const result = await bonanzaCall("reviseFixedPriceItemRequest", {
        itemId: Number(itemId), item,
      });
      const resultItem = result.reviseFixedPriceItemResponse;
      if (!resultItem || String(resultItem.itemId) !== itemId) {
        throw new Error("Bonanza returned an ambiguous publish response.");
      }
      const listed = await getBoothItem(itemId, boothId);
      const actualStatus = String(listed?.listingStatus ?? resultItem.sellingState ?? "Unknown");
      const active = listed != null && ["active", "for sale"].includes(actualStatus.toLowerCase());
      const remoteQuantity = listed == null ? null : Number(listed.quantity);
      const remotePrice = listed == null ? null : Number(listed.currentPrice);

      // Treat a publish as VERIFIED only when Bonanza's current, read-back
      // listing matches all the important values we attempted to send.
      const verified = active &&
        remoteQuantity === product.quantity &&
        remotePrice !== null && Number.isFinite(remotePrice) &&
        Math.abs(remotePrice - price) < 0.01 &&
        listed?.title === title;

      // Record the time of ANY attempted activation, even if verification is
      // inconclusive. Otherwise a later paid order could be missed by sync.
      // "needs_verification" also blocks a repeated publish request.
      const { error: updateError } = await admin.from("bonanza_publications")
        .update({
          status: verified ? "active" : "needs_verification",
          published_at: mapping.created_at,
        })
        .eq("id", mapping.id);
      if (updateError) {
        throw new Error("Bonanza may have activated the item, but saving the local mapping failed.");
      }

      if (!verified) {
        return Response.json({
          success: false,
          published: false, // NOT a claim that the remote item is inactive!
          checkBooth: true,
          itemId,
          status: actualStatus,
          bonanzaQuantity: remoteQuantity,
          error: "Bonanza accepted the revision, but the active listing's title, price, quantity or status was not verified. Check the live Bonanza booth and database mapping. Do NOT publish again.",
        }, { status: 409 });
      }

      return Response.json({
        success: true,
        published: true,
        itemId, status: actualStatus, price,
        centralQuantity: product.quantity,
        bonanzaQuantity: remoteQuantity,
        message: "Bonanza verified an active listing with the expected title, price and quantity. Real buyers can purchase it.",
      });
    } catch (error) {
      if (writeAttempted) {
        // A timeout/HTTP error can occur AFTER Bonanza has activated an item.
        // Save an order-sync starting point and require manual verification.
        await admin.from("bonanza_publications")
          .update({ status: "needs_verification", published_at: mapping.created_at })
          .eq("id", mapping.id);
      }
      // Never retry automatically: the external write might have succeeded.
      throw error;
    }
  } catch (error) {
    console.error("Bonanza LIVE publish:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({
      error: publishAttempted
        ? "Publish may have succeeded but was not verified. Inspect the Bonanza booth and mapping before any retry."
        : error instanceof Error ? error.message : "Bonanza publishing preflight failed.",
      checkBooth: publishAttempted,
    }, { status: publishAttempted ? 502 : 400 });
  }
}