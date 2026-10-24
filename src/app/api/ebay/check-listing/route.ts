import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

const EBAY_API_BASE =
  "https://api.sandbox.ebay.com";

/*
 * =====================================================
 * CHECK EBAY SANDBOX LISTINGS
 * =====================================================
 *
 * This route:
 *
 * 1. Finds the logged-in user's products.
 * 2. Finds their ListNexus eBay Sandbox records.
 * 3. Asks eBay directly for each offer.
 * 4. Returns both our local state and eBay's state.
 *
 * It DOES NOT create, edit, publish, or delete anything.
 */

export async function GET() {
  try {
    /*
     * =================================================
     * AUTHENTICATE
     * =================================================
     */

    const supabase =
      await createClient();

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !user
    ) {
      return Response.json(
        {
          error:
            "You must be logged into ListNexus.",
        },
        {
          status: 401,
        }
      );
    }

    const admin =
      createAdminClient();

    /*
     * =================================================
     * FIND THIS USER'S PRODUCTS
     * =================================================
     */

    const {
      data: products,
      error: productsError,
    } = await admin
      .from("products")
      .select(`
        id,
        title,
        sku
      `)
      .eq(
        "user_id",
        user.id
      );

    if (productsError) {
      console.error(
        productsError
      );

      return Response.json(
        {
          error:
            "Could not load ListNexus products.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !products ||
      products.length === 0
    ) {
      return Response.json({
        success: true,
        listings: [],
        message:
          "No ListNexus products were found.",
      });
    }

    const productIds =
      products.map(
        (product) =>
          product.id
      );

    /*
     * Quick product lookup.
     */
    const productById =
      new Map(
        products.map(
          (product) => [
            product.id,
            product,
          ]
        )
      );

    /*
     * =================================================
     * FIND OUR LOCAL EBAY RECORDS
     * =================================================
     */

    const {
      data: listings,
      error: listingsError,
    } = await admin
      .from(
        "marketplace_listings"
      )
      .select(`
        id,
        product_id,
        marketplace,
        environment,
        external_offer_id,
        external_listing_id,
        external_category_id,
        listing_url,
        price,
        quantity,
        status,
        last_synced_at
      `)
      .in(
        "product_id",
        productIds
      )
      .eq(
        "marketplace",
        "EBAY"
      )
      .eq(
        "environment",
        "SANDBOX"
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      );

    if (listingsError) {
      console.error(
        listingsError
      );

      return Response.json(
        {
          error:
            "Could not load ListNexus marketplace listings.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !listings ||
      listings.length === 0
    ) {
      return Response.json({
        success: true,
        listings: [],
        message:
          "No eBay Sandbox marketplace listings were found.",
      });
    }

    /*
     * =================================================
     * GET VALID EBAY TOKEN
     * =================================================
     */

    const accessToken =
      await getEbayAccessToken(
        user.id
      );

    /*
     * =================================================
     * ASK EBAY ABOUT EACH OFFER
     * =================================================
     */

    const results =
      await Promise.all(
        listings.map(
          async (
            listing
          ) => {
            const product =
              productById.get(
                listing.product_id
              );

            /*
             * No offer ID means we cannot ask eBay
             * for this listing.
             */
            if (
              !listing.external_offer_id
            ) {
              return {
                product,

                listNexus: {
                  ...listing,
                },

                ebay: {
                  found:
                    false,

                  error:
                    "ListNexus does not have an eBay offer ID for this record.",
                },
              };
            }

            const offerUrl =
              `${EBAY_API_BASE}` +
              `/sell/inventory/v1/offer/` +
              `${encodeURIComponent(
                listing.external_offer_id
              )}`;

            try {
              const response =
                await fetch(
                  offerUrl,
                  {
                    method:
                      "GET",

                    headers: {
                      Authorization:
                        `Bearer ${accessToken}`,

                      Accept:
                        "application/json",

                      "Accept-Language":
                        "en-US",
                    },

                    cache:
                      "no-store",
                  }
                );

              const responseText =
                await response.text();

              let offerData:
                any = null;

              if (
                responseText
              ) {
                try {
                  offerData =
                    JSON.parse(
                      responseText
                    );
                } catch {
                  offerData = {
                    raw:
                      responseText,
                  };
                }
              }

              /*
               * eBay could not find/read the offer.
               */
              if (
                !response.ok
              ) {
                return {
                  product,

                  listNexus: {
                    ...listing,
                  },

                  ebay: {
                    found:
                      false,

                    httpStatus:
                      response.status,

                    error:
                      offerData
                        ?.errors?.[0]
                        ?.longMessage ||
                      offerData
                        ?.errors?.[0]
                        ?.message ||
                      `eBay returned HTTP ${response.status}.`,

                    raw:
                      offerData,
                  },
                };
              }

              /*
               * Success.
               *
               * We intentionally return several useful
               * fields plus the raw eBay offer so we can
               * inspect exactly what Sandbox says.
               */
              return {
                product,

                listNexus: {
                  id:
                    listing.id,

                  status:
                    listing.status,

                  offerId:
                    listing.external_offer_id,

                  listingId:
                    listing.external_listing_id,

                  listingUrl:
                    listing.listing_url,

                  categoryId:
                    listing.external_category_id,

                  quantity:
                    listing.quantity,

                  price:
                    listing.price,

                  lastSyncedAt:
                    listing.last_synced_at,
                },

                ebay: {
                  found:
                    true,

                  offerId:
                    offerData.offerId,

                  sku:
                    offerData.sku,

                  status:
                    offerData.status,

                  marketplaceId:
                    offerData.marketplaceId,

                  availableQuantity:
                    offerData.availableQuantity,

                  categoryId:
                    offerData.categoryId,

                  price:
                    offerData
                      ?.pricingSummary
                      ?.price,

                  listing:
                    offerData.listing,

                  raw:
                    offerData,
                },
              };
            } catch (
              ebayError
            ) {
              return {
                product,

                listNexus: {
                  ...listing,
                },

                ebay: {
                  found:
                    false,

                  error:
                    ebayError instanceof
                    Error
                      ? ebayError.message
                      : "Could not contact eBay Sandbox.",
                },
              };
            }
          }
        )
      );

    /*
     * =================================================
     * RETURN DIAGNOSTIC RESULTS
     * =================================================
     */

    return Response.json({
      success: true,

      environment:
        "SANDBOX",

      checked:
        results.length,

      listings:
        results,
    });
  } catch (error) {
    console.error(
      "eBay listing check error:",
      error
    );

    return Response.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Could not check eBay Sandbox listings.",
      },
      {
        status: 500,
      }
    );
  }
}