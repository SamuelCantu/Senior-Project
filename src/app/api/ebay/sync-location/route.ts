import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

export async function POST() {
  /*
   * STEP 1:
   * Find the logged-in ListNexus user.
   */
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        error: "You must be logged into ListNexus.",
      },
      { status: 401 }
    );
  }

  /*
   * STEP 2:
   * Get the user's default CENTRALIZED ListNexus location.
   *
   * Supabase is the source of truth.
   */
  const { data: location, error: locationError } =
    await supabase
      .from("locations")
      .select(
        `
          id,
          name,
          address_line_1,
          address_line_2,
          city,
          state_region,
          postal_code,
          country_code,
          is_default
        `
      )
      .eq("user_id", user.id)
      .eq("is_default", true)
      .single();

  if (locationError || !location) {
    return NextResponse.json(
      {
        error:
          "No default ListNexus location was found for this user.",
      },
      { status: 404 }
    );
  }

  try {
    /*
     * STEP 3:
     * Get a valid eBay token.
     */
    const accessToken =
      await getEbayAccessToken(user.id);

    const admin = createAdminClient();

    /*
     * STEP 4:
     * Check whether this ListNexus location already
     * has an eBay Sandbox mapping.
     */
    const { data: existingMapping } = await admin
      .from("marketplace_locations")
      .select(
        `
          id,
          external_location_id,
          sync_status,
          last_synced_at
        `
      )
      .eq("location_id", location.id)
      .eq("marketplace", "EBAY")
      .eq("environment", "SANDBOX")
      .maybeSingle();

    /*
     * If a mapping already exists, verify that the
     * corresponding location still exists in eBay.
     */
    if (existingMapping) {
      const verifyResponse = await fetch(
        `https://api.sandbox.ebay.com/sell/inventory/v1/location/${encodeURIComponent(
          existingMapping.external_location_id
        )}`,
        {
          method: "GET",

          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Accept-Language": "en-US",
          },
        }
      );

      if (verifyResponse.ok) {
        const ebayLocation =
          await verifyResponse.json();

        await admin
          .from("marketplace_locations")
          .update({
            sync_status: "SYNCED",
            last_synced_at:
              new Date().toISOString(),
            updated_at:
              new Date().toISOString(),
          })
          .eq("id", existingMapping.id);

        return NextResponse.json({
          success: true,
          message:
            "This ListNexus location is already synced with eBay.",
          listNexusLocation: location,
          merchantLocationKey:
            existingMapping.external_location_id,
          ebayLocation,
        });
      }
    }

    /*
     * STEP 5:
     * Generate an eBay-specific merchantLocationKey.
     *
     * The key comes FROM the ListNexus location ID,
     * so we aren't creating a separate location identity
     * as our source of truth.
     *
     * eBay allows up to 50 characters.
     */
    const merchantLocationKey =
      `LN-${location.id.replaceAll("-", "").slice(0, 32)}`;

    /*
     * STEP 6:
     * Translate the ListNexus location into eBay's
     * location format.
     */
    const ebayAddress: Record<string, string> = {
      postalCode: location.postal_code,
      country: location.country_code,
    };

    if (location.address_line_1) {
      ebayAddress.addressLine1 =
        location.address_line_1;
    }

    if (location.address_line_2) {
      ebayAddress.addressLine2 =
        location.address_line_2;
    }

    if (location.city) {
      ebayAddress.city = location.city;
    }

    if (location.state_region) {
      ebayAddress.stateOrProvince =
        location.state_region;
    }

    /*
     * STEP 7:
     * Create the translated location in eBay Sandbox.
     */
    const createResponse = await fetch(
      `https://api.sandbox.ebay.com/sell/inventory/v1/location/${encodeURIComponent(
        merchantLocationKey
      )}`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": "en-US",
          "Content-Language": "en-US",
        },

        body: JSON.stringify({
          location: {
            address: ebayAddress,
          },

          name: location.name,

          merchantLocationStatus:
            "ENABLED",

          locationTypes: [
            "WAREHOUSE",
          ],
        }),
      }
    );

    /*
     * STEP 8:
     * Handle an eBay failure.
     */
    if (!createResponse.ok) {
      const errorText =
        await createResponse.text();

      let details: unknown =
        errorText;

      try {
        details =
          JSON.parse(errorText);
      } catch {
        // Leave it as plain text.
      }

      return NextResponse.json(
        {
          error:
            "ListNexus could not sync the location to eBay.",
          status:
            createResponse.status,
          details,
        },
        {
          status:
            createResponse.status,
        }
      );
    }

    /*
     * STEP 9:
     * Save the marketplace-specific mapping.
     *
     * Supabase location:
     *      location.id
     *
     * eBay representation:
     *      merchantLocationKey
     */
    const now =
      new Date().toISOString();

    const {
      data: mapping,
      error: mappingError,
    } = await admin
      .from("marketplace_locations")
      .upsert(
        {
          location_id:
            location.id,

          marketplace:
            "EBAY",

          environment:
            "SANDBOX",

          external_location_id:
            merchantLocationKey,

          sync_status:
            "SYNCED",

          last_synced_at:
            now,

          updated_at:
            now,
        },
        {
          onConflict:
            "location_id,marketplace,environment",
        }
      )
      .select()
      .single();

    if (mappingError) {
      console.error(
        "Location mapping save failed:",
        mappingError
      );

      return NextResponse.json(
        {
          error:
            "The location was created in eBay, but ListNexus could not save the marketplace mapping.",
        },
        { status: 500 }
      );
    }

    /*
     * STEP 10:
     * Return both sides of the relationship.
     */
    return NextResponse.json({
      success: true,

      message:
        "ListNexus location successfully synced to eBay Sandbox.",

      listNexusLocation: {
        id: location.id,
        name: location.name,
        postalCode:
          location.postal_code,
        country:
          location.country_code,
      },

      ebay: {
        merchantLocationKey,
      },

      mapping,
    });
  } catch (error) {
    console.error(
      "eBay location sync error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown location sync error.",
      },
      { status: 500 }
    );
  }
}