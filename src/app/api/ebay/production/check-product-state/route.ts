import { createClient } from "@/lib/supabase/server";

import {
    getProductionEbayAccessToken,
} from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";

const EBAY_API_BASE =
    "https://api.ebay.com";

const MARKETPLACE_ID =
    "EBAY_US";

async function readEbayResponse(
    response: Response
) {
    const text =
        await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export async function GET(
    request: Request
) {
    try {
        /*
         * =====================================================
         * STEP 1
         * Make sure the ListNexus user is logged in.
         * =====================================================
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

        /*
         * =====================================================
         * STEP 2
         * Read productId from the URL.
         * =====================================================
         */

        const url =
            new URL(request.url);

        const productId =
            url.searchParams.get(
                "productId"
            );

        if (!productId) {
            return Response.json(
                {
                    error:
                        "Missing productId.",
                },
                {
                    status: 400,
                }
            );
        }

        /*
         * =====================================================
         * STEP 3
         * Load the ListNexus product.
         * =====================================================
         */

        const {
            data: product,
            error: productError,
        } =
            await supabase
                .from("products")
                .select(`
          id,
          sku,
          title
        `)
                .eq(
                    "id",
                    productId
                )
                .eq(
                    "user_id",
                    user.id
                )
                .single();

        if (
            productError ||
            !product
        ) {
            return Response.json(
                {
                    error:
                        "Product not found.",
                },
                {
                    status: 404,
                }
            );
        }

        if (!product.sku) {
            return Response.json(
                {
                    error:
                        "This product does not have a SKU.",
                },
                {
                    status: 400,
                }
            );
        }

        /*
         * =====================================================
         * STEP 4
         * Get the REAL Production eBay access token.
         * =====================================================
         */

        const accessToken =
            await getProductionEbayAccessToken(
                user.id
            );

        const headers = {
            Authorization:
                `Bearer ${accessToken}`,

            Accept:
                "application/json",

            "Accept-Language":
                "en-US",

            "Content-Language":
                "en-US",

            "X-EBAY-C-MARKETPLACE-ID":
                MARKETPLACE_ID,
        };

        /*
         * =====================================================
         * STEP 5
         * Check whether the inventory item exists.
         *
         * This is READ ONLY.
         * =====================================================
         */

        const inventoryItemUrl =
            `${EBAY_API_BASE}` +
            `/sell/inventory/v1/inventory_item/` +
            `${encodeURIComponent(
                product.sku
            )}`;

        const inventoryResponse =
            await fetch(
                inventoryItemUrl,
                {
                    method:
                        "GET",

                    headers,

                    cache:
                        "no-store",
                }
            );

        const inventoryData =
            await readEbayResponse(
                inventoryResponse
            );

        /*
         * =====================================================
         * STEP 6
         * Check for any eBay offers associated with this SKU.
         *
         * This is also READ ONLY.
         * =====================================================
         */

        const offersUrl =
            new URL(
                `${EBAY_API_BASE}/sell/inventory/v1/offer`
            );

        offersUrl.searchParams.set(
            "sku",
            product.sku
        );

        offersUrl.searchParams.set(
            "marketplace_id",
            MARKETPLACE_ID
        );

        const offersResponse =
            await fetch(
                offersUrl.toString(),
                {
                    method:
                        "GET",

                    headers,

                    cache:
                        "no-store",
                }
            );

        const offersData =
            await readEbayResponse(
                offersResponse
            );

        /*
         * =====================================================
         * STEP 7
         * Return both pieces of state.
         * =====================================================
         */

        return Response.json({
            success: true,

            environment:
                "PRODUCTION",

            product: {
                id:
                    product.id,

                sku:
                    product.sku,

                title:
                    product.title,
            },

            inventoryItem: {
                exists:
                    inventoryResponse.ok,

                status:
                    inventoryResponse.status,

                data:
                    inventoryData,
            },

            offers: {
                success:
                    offersResponse.ok,

                status:
                    offersResponse.status,

                data:
                    offersData,
            },
        });
    } catch (error) {
        console.error(
            "Production eBay product-state check error:",
            error
        );

        return Response.json(
            {
                success: false,

                error:
                    error instanceof Error
                        ? error.message
                        : "Could not check eBay Production product state.",
            },
            {
                status: 500,
            }
        );
    }
}