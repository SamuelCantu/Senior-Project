import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  getProductionEbayAccessToken,
} from "@/lib/ebay/getProductionAccessToken";

export const runtime =
  "nodejs";

const EBAY_API_BASE =
  "https://api.ebay.com";

async function setupProductionLocation() {
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

    const admin =
      createAdminClient();

    /*
     * =====================================================
     * STEP 2
     * Load the user's default centralized location.
     * =====================================================
     */

    let {
      data: location,
      error: locationError,
    } = await admin
      .from("locations")
      .select(`
        id,
        name,
        address_line_1,
        address_line_2,
        city,
        state_region,
        postal_code,
        country_code,
        is_default
      `)
      .eq(
        "user_id",
        user.id
      )
      .eq(
        "is_default",
        true
      )
      .maybeSingle();

    /*
     * If no location is marked default,
     * use the user's first saved location.
     */
    if (
      !location &&
      !locationError
    ) {
      const {
        data: fallback,
        error: fallbackError,
      } = await admin
        .from("locations")
        .select(`
          id,
          name,
          address_line_1,
          address_line_2,
          city,
          state_region,
          postal_code,
          country_code,
          is_default
        `)
        .eq(
          "user_id",
          user.id
        )
        .limit(1)
        .maybeSingle();

      location =
        fallback;

      locationError =
        fallbackError;
    }

    if (
      locationError ||
      !location
    ) {
      return Response.json(
        {
          error:
            "No ListNexus inventory location was found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * =====================================================
     * STEP 3
     * Check whether this location is already mapped to
     * eBay Production.
     * =====================================================
     */

    const {
      data: existingMapping,
      error: mappingLookupError,
    } = await admin
      .from(
        "marketplace_locations"
      )
      .select(`
        id,
        external_location_id,
        sync_status
      `)
      .eq(
        "location_id",
        location.id
      )
      .eq(
        "marketplace",
        "EBAY"
      )
      .eq(
        "environment",
        "PRODUCTION"
      )
      .maybeSingle();

    if (mappingLookupError) {
      console.error(
        "Production location mapping lookup failed:",
        mappingLookupError
      );

      return Response.json(
        {
          error:
            "Could not check the Production inventory location.",
        },
        {
          status: 500,
        }
      );
    }

    if (existingMapping) {
      return Response.json({
        success: true,

        alreadyExists:
          true,

        message:
          "eBay Production inventory location is already connected.",

        merchantLocationKey:
          existingMapping.external_location_id,
      });
    }

    /*
     * =====================================================
     * STEP 4
     * Generate a permanent eBay merchantLocationKey.
     *
     * eBay does not allow this key to be changed after
     * the inventory location is created.
     * =====================================================
     */

    const merchantLocationKey =
      `LNPROD${location.id
        .replace(/-/g, "")
        .slice(0, 24)}`;

    /*
     * =====================================================
     * STEP 5
     * Get the REAL Production seller token.
     * =====================================================
     */

    const accessToken =
      await getProductionEbayAccessToken(
        user.id
      );

    /*
     * =====================================================
     * STEP 6
     * Check eBay first in case the location was created
     * previously but the local mapping failed to save.
     * =====================================================
     */

    const encodedKey =
      encodeURIComponent(
        merchantLocationKey
      );

    const getResponse =
      await fetch(
        `${EBAY_API_BASE}/sell/inventory/v1/location/${encodedKey}`,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${accessToken}`,

            Accept:
              "application/json",
          },

          cache:
            "no-store",
        }
      );

    let locationExistsOnEbay =
      getResponse.ok;

    /*
     * A status other than 404 means something unexpected
     * happened while checking the location.
     */
    if (
      !getResponse.ok &&
      getResponse.status !==
      404
    ) {
      const errorText =
        await getResponse.text();

      console.error(
        "eBay Production location lookup failed:",
        getResponse.status,
        errorText
      );

      return Response.json(
        {
          error:
            "eBay could not check the Production inventory location.",
        },
        {
          status:
            getResponse.status,
        }
      );
    }

    /*
     * =====================================================
     * STEP 7
     * Create the REAL eBay Production warehouse if needed.
     * =====================================================
     */

    if (
      !locationExistsOnEbay
    ) {

      /*
 * =====================================================
 * STEP 7
 * Create the REAL eBay Production warehouse if needed.
 *
 * Keep the payload intentionally minimal.
 * eBay only requires postalCode + country for a
 * standard WAREHOUSE location.
 * =====================================================
 */

      if (!locationExistsOnEbay) {
        const postalCode =
          location.postal_code
            ?.toString()
            .trim();

        const country =
          location.country_code
            ?.toString()
            .trim()
            .toUpperCase();

        const locationName =
          location.name
            ?.toString()
            .trim() ||
          "ListNexus Warehouse";

        /*
         * Validate our own database values before
         * sending anything to eBay.
         */
        if (!postalCode) {
          return Response.json(
            {
              error:
                "The ListNexus location does not have a postal code.",
            },
            {
              status: 400,
            }
          );
        }

        if (!country) {
          return Response.json(
            {
              error:
                "The ListNexus location does not have a country code.",
            },
            {
              status: 400,
            }
          );
        }

        /*
         * Exact minimal warehouse structure documented
         * by eBay.
         */
        const createPayload = {
          location: {
            address: {
              postalCode,
              country,
            },
          },

          name:
            locationName,

          merchantLocationStatus:
            "ENABLED",

          locationTypes: [
            "WAREHOUSE",
          ],
        };

        console.log(
          "Creating eBay Production location:",
          {
            merchantLocationKey,
            name:
              locationName,
            postalCode,
            country,
          }
        );

        const createResponse =
          await fetch(
            `${EBAY_API_BASE}/sell/inventory/v1/location/${encodeURIComponent(
              merchantLocationKey
            )}`,
            {
              method:
                "POST",

              headers: {
                Authorization:
                  `Bearer ${accessToken}`,

                "Content-Type":
                  "application/json",

                Accept:
                  "application/json",
              },

              body:
                JSON.stringify(
                  createPayload
                ),

              cache:
                "no-store",
            }
          );

        if (!createResponse.ok) {
          const errorText =
            await createResponse.text();

          console.error(
            "eBay Production inventory location creation failed:",
            createResponse.status,
            errorText
          );

          return Response.json(
            {
              error:
                "eBay rejected the Production inventory location.",

              ebayStatus:
                createResponse.status,

              details:
                errorText,

              /*
               * Safe diagnostic information.
               * We intentionally do NOT expose a street address.
               */
              requestSummary: {
                merchantLocationKey,
                name:
                  locationName,
                postalCode,
                country,
                locationType:
                  "WAREHOUSE",
              },
            },
            {
              status:
                createResponse.status,
            }
          );
        }

        locationExistsOnEbay =
          true;
      }

      locationExistsOnEbay =
        true;
    }

    /*
     * =====================================================
     * STEP 8
     * Save the Production mapping in ListNexus.
     * =====================================================
     */

    const now =
      new Date().toISOString();

    const {
      error: insertError,
    } = await admin
      .from(
        "marketplace_locations"
      )
      .insert({
        location_id:
          location.id,

        marketplace:
          "EBAY",

        environment:
          "PRODUCTION",

        external_location_id:
          merchantLocationKey,

        sync_status:
          "SYNCED",

        last_synced_at:
          now,

        updated_at:
          now,
      });

    if (insertError) {
      console.error(
        "Could not save Production inventory location mapping:",
        insertError
      );

      return Response.json(
        {
          error:
            "eBay created the Production location, but ListNexus could not save its mapping.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * SUCCESS
     * =====================================================
     */

    return Response.json({
      success: true,

      message:
        "eBay Production inventory location created successfully.",

      environment:
        "PRODUCTION",

      marketplace:
        "EBAY",

      locationName:
        location.name,

      merchantLocationKey,
    });
  } catch (error) {
    console.error(
      "eBay Production location setup error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not set up the eBay Production inventory location.",
      },
      {
        status: 500,
      }
    );
  }
}

/*
 * GET lets us conveniently run the setup by opening
 * the URL in the browser while logged into ListNexus.
 */
export async function GET() {
  return setupProductionLocation();
}

/*
 * POST is also supported for the application's
 * future setup interface.
 */
export async function POST() {
  return setupProductionLocation();
}