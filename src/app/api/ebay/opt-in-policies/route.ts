import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
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

  try {
    /*
     * STEP 2:
     * Get a valid eBay access token.
     */
    const accessToken =
      await getEbayAccessToken(user.id);

    /*
     * STEP 3:
     * Opt the Sandbox seller into
     * Selling Policy Management.
     */
    const ebayResponse = await fetch(
      "https://api.sandbox.ebay.com/sell/account/v1/program/opt_in",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Language": "en-US",
        },

        body: JSON.stringify({
          programType:
            "SELLING_POLICY_MANAGEMENT",
        }),
      }
    );

    /*
     * eBay may return an empty body on success,
     * so don't assume JSON exists.
     */
    const responseText =
      await ebayResponse.text();

    let details: unknown = null;

    if (responseText) {
      try {
        details =
          JSON.parse(responseText);
      } catch {
        details = responseText;
      }
    }

    if (!ebayResponse.ok) {
      return NextResponse.json(
        {
          error:
            "Could not opt the eBay seller into Selling Policy Management.",
          status: ebayResponse.status,
          details,
        },
        { status: ebayResponse.status }
      );
    }

    return NextResponse.json({
      success: true,

      message:
        "eBay Sandbox seller successfully opted into Selling Policy Management.",

      programType:
        "SELLING_POLICY_MANAGEMENT",
    });
  } catch (error) {
    console.error(
      "eBay Selling Policy opt-in error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown eBay program opt-in error.",
      },
      { status: 500 }
    );
  }
}