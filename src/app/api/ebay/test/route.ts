import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

export async function POST() {
  /*
   * STEP 1:
   * Make sure the person making this request
   * is logged into ListNexus.
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

  try {
    /*
     * STEP 2:
     * Get a valid eBay access token.
     *
     * Our helper automatically refreshes it if necessary.
     */
    const accessToken = await getEbayAccessToken(user.id);

    /*
     * Every eBay Inventory API item needs a seller-defined SKU.
     *
     * Reusing this same SKU will UPDATE the existing inventory
     * item instead of creating duplicates.
     */
    const sku = "LISTNEXUS-TEST-001";

    /*
     * STEP 3:
     * Create our first test inventory item.
     */
    const createResponse = await fetch(
      `https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(
        sku
      )}`,
      {
        method: "PUT",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Language": "en-US",
          "Accept-Language": "en-US",
        },

        body: JSON.stringify({
          availability: {
            shipToLocationAvailability: {
              quantity: 1,
            },
          },

          condition: "NEW",

          product: {
            title: "ListNexus Sandbox Test Trading Card",

            description:
              "Test inventory item created by ListNexus in the eBay Sandbox. This is not a real product.",

            aspects: {
              Brand: ["ListNexus"],
              Type: ["Trading Card"],
            },
          },
        }),
      }
    );

    /*
     * eBay normally returns HTTP 204 with NO response body
     * when an inventory item is successfully created.
     */
    if (!createResponse.ok) {
      const errorText = await createResponse.text();

      let details: unknown = errorText;

      try {
        details = JSON.parse(errorText);
      } catch {
        // Leave the error as plain text if it isn't JSON.
      }

      return NextResponse.json(
        {
          error: "Failed to create eBay inventory item.",
          status: createResponse.status,
          details,
        },
        { status: createResponse.status }
      );
    }

    /*
     * STEP 4:
     * Retrieve the item we just created so we can
     * immediately prove that it exists in eBay.
     */
    const getResponse = await fetch(
      `https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(
        sku
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

    if (!getResponse.ok) {
      return NextResponse.json({
        success: true,
        message:
          "The inventory item was created, but ListNexus could not retrieve it afterward.",
        sku,
      });
    }

    const inventoryItem = await getResponse.json();

    /*
     * STEP 5:
     * Return the inventory record to us.
     */
    return NextResponse.json({
      success: true,
      message: "eBay Sandbox inventory item created successfully.",
      sku,
      inventoryItem,
    });
  } catch (error) {
    console.error("Create eBay inventory item error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown eBay inventory error.",
      },
      { status: 500 }
    );
  }
}