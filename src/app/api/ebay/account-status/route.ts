import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

export async function GET() {
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
     * Get a valid eBay token.
     */
    const accessToken = await getEbayAccessToken(user.id);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    };

    /*
     * STEP 3:
     * Ask eBay which seller programs this account
     * is currently opted into.
     */
    const programsResponse = await fetch(
      "https://api.sandbox.ebay.com/sell/account/v1/program/get_opted_in_programs",
      {
        method: "GET",
        headers,
      }
    );

    /*
     * STEP 4:
     * Retrieve any existing eBay business policies
     * for the US marketplace.
     */
    const fulfillmentResponse = await fetch(
      "https://api.sandbox.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US",
      {
        method: "GET",
        headers,
      }
    );

    const paymentResponse = await fetch(
      "https://api.sandbox.ebay.com/sell/account/v1/payment_policy?marketplace_id=EBAY_US",
      {
        method: "GET",
        headers,
      }
    );

    const returnResponse = await fetch(
      "https://api.sandbox.ebay.com/sell/account/v1/return_policy?marketplace_id=EBAY_US",
      {
        method: "GET",
        headers,
      }
    );

    /*
     * Helper for safely reading JSON or plain-text responses.
     */
    async function readResponse(response: Response) {
      const text = await response.text();

      if (!text) {
        return null;
      }

      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    const programs = await readResponse(programsResponse);
    const fulfillmentPolicies =
      await readResponse(fulfillmentResponse);
    const paymentPolicies =
      await readResponse(paymentResponse);
    const returnPolicies =
      await readResponse(returnResponse);

    /*
     * STEP 5:
     * Return everything so we can inspect the seller account.
     */
    return NextResponse.json({
      success:
        programsResponse.ok &&
        fulfillmentResponse.ok &&
        paymentResponse.ok &&
        returnResponse.ok,

      programs: {
        status: programsResponse.status,
        data: programs,
      },

      fulfillmentPolicies: {
        status: fulfillmentResponse.status,
        data: fulfillmentPolicies,
      },

      paymentPolicies: {
        status: paymentResponse.status,
        data: paymentPolicies,
      },

      returnPolicies: {
        status: returnResponse.status,
        data: returnPolicies,
      },
    });
  } catch (error) {
    console.error("eBay account status error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown eBay account error.",
      },
      { status: 500 }
    );
  }
}