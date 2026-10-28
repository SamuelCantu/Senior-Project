import { createClient } from "@/lib/supabase/server";

import {
  getProductionEbayAccessToken,
} from "@/lib/ebay/getProductionAccessToken";

export const runtime = "nodejs";

const EBAY_API_BASE =
  "https://api.ebay.com";

const MARKETPLACE_ID =
  "EBAY_US";

type PaymentPolicy = {
  paymentPolicyId: string;
  name: string;
};

type FulfillmentPolicy = {
  fulfillmentPolicyId: string;
  name: string;
};

type ReturnPolicy = {
  returnPolicyId: string;
  name: string;
};

type PaymentPolicyResponse = {
  paymentPolicies?: PaymentPolicy[];
};

type FulfillmentPolicyResponse = {
  fulfillmentPolicies?: FulfillmentPolicy[];
};

type ReturnPolicyResponse = {
  returnPolicies?: ReturnPolicy[];
};

export async function GET() {
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
    };

    /*
     * =====================================================
     * STEP 3
     * Ask eBay for all three Production policy types.
     *
     * eBay calls shipping policies
     * "fulfillment policies" in the API.
     * =====================================================
     */

    const [
      paymentResponse,
      fulfillmentResponse,
      returnResponse,
    ] =
      await Promise.all([
        fetch(
          `${EBAY_API_BASE}/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE_ID}`,
          {
            headers,
            cache:
              "no-store",
          }
        ),

        fetch(
          `${EBAY_API_BASE}/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE_ID}`,
          {
            headers,
            cache:
              "no-store",
          }
        ),

        fetch(
          `${EBAY_API_BASE}/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE_ID}`,
          {
            headers,
            cache:
              "no-store",
          }
        ),
      ]);

    /*
     * =====================================================
     * STEP 4
     * Handle eBay API errors.
     * =====================================================
     */

    if (
      !paymentResponse.ok ||
      !fulfillmentResponse.ok ||
      !returnResponse.ok
    ) {
      const paymentError =
        !paymentResponse.ok
          ? await paymentResponse.text()
          : null;

      const fulfillmentError =
        !fulfillmentResponse.ok
          ? await fulfillmentResponse.text()
          : null;

      const returnError =
        !returnResponse.ok
          ? await returnResponse.text()
          : null;

      console.error(
        "Production policy lookup failed:",
        {
          paymentError,
          fulfillmentError,
          returnError,
        }
      );

      return Response.json(
        {
          error:
            "Could not retrieve one or more eBay Production business policies.",

          statuses: {
            payment:
              paymentResponse.status,

            fulfillment:
              fulfillmentResponse.status,

            returns:
              returnResponse.status,
          },

          details: {
            payment:
              paymentError,

            fulfillment:
              fulfillmentError,

            returns:
              returnError,
          },
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * STEP 5
     * Parse responses.
     * =====================================================
     */

    const paymentData =
      (await paymentResponse.json()) as PaymentPolicyResponse;

    const fulfillmentData =
      (await fulfillmentResponse.json()) as FulfillmentPolicyResponse;

    const returnData =
      (await returnResponse.json()) as ReturnPolicyResponse;

    /*
     * =====================================================
     * STEP 6
     * Find the three policies we just created.
     * =====================================================
     */

    const paymentPolicy =
      paymentData.paymentPolicies?.find(
        (policy) =>
          policy.name ===
          "ListNexus Payment"
      );

    const fulfillmentPolicy =
      fulfillmentData.fulfillmentPolicies?.find(
        (policy) =>
          policy.name ===
          "ListNexus Shipping"
      );

    const returnPolicy =
      returnData.returnPolicies?.find(
        (policy) =>
          policy.name ===
          "ListNexus Returns"
      );

    /*
    * =====================================================
    * STEP 7
    * Make sure all three policies were found.
    * =====================================================
    */

    if (
    !paymentPolicy ||
    !fulfillmentPolicy ||
    !returnPolicy
    ) {
    const missing: string[] = [];

    if (!paymentPolicy) {
        missing.push(
        "ListNexus Payment"
        );
    }

    if (!fulfillmentPolicy) {
        missing.push(
        "ListNexus Shipping"
        );
    }

    if (!returnPolicy) {
        missing.push(
        "ListNexus Returns"
        );
    }

    return Response.json(
        {
        success: false,

        error:
            "One or more ListNexus policies could not be found on eBay Production.",

        missing,

        availablePolicies: {
            payment:
            paymentData.paymentPolicies?.map(
                (policy) => policy.name
            ) ?? [],

            fulfillment:
            fulfillmentData.fulfillmentPolicies?.map(
                (policy) => policy.name
            ) ?? [],

            returns:
            returnData.returnPolicies?.map(
                (policy) => policy.name
            ) ?? [],
        },
        },
        {
        status: 404,
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

      environment:
        "PRODUCTION",

      marketplace:
        MARKETPLACE_ID,

      policies: {
        payment: {
          name:
            paymentPolicy.name,

          id:
            paymentPolicy.paymentPolicyId,
        },

        fulfillment: {
          name:
            fulfillmentPolicy.name,

          id:
            fulfillmentPolicy.fulfillmentPolicyId,
        },

        returns: {
          name:
            returnPolicy.name,

          id:
            returnPolicy.returnPolicyId,
        },
      },

      message:
        "All required eBay Production business policies were found.",
    });
  } catch (error) {
    console.error(
      "Production policy check error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not check eBay Production policies.",
      },
      {
        status: 500,
      }
    );
  }
}