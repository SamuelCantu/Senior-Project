import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

type PolicyType = "PAYMENT" | "FULFILLMENT" | "RETURN";

type BusinessPolicy = {
  id: string;
  name: string;
  policy_type: PolicyType;
  config: Record<string, unknown>;
};

/*
 * Translate our centralized ListNexus shipping service
 * into eBay's marketplace-specific shipping service code.
 *
 * Later this can grow into a larger marketplace adapter.
 */
function getEbayShippingService(
  carrier: string,
  service: string
) {
  if (
    carrier === "USPS" &&
    service === "PRIORITY_FLAT_RATE_BOX"
  ) {
    return "USPSPriorityFlatRateBox";
  }

  throw new Error(
    `Unsupported ListNexus shipping service: ${carrier} / ${service}`
  );
}

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
   * Read the user's DEFAULT centralized policies.
   */
  const { data: policies, error: policiesError } =
    await supabase
      .from("business_policies")
      .select(
        `
          id,
          name,
          policy_type,
          config
        `
      )
      .eq("user_id", user.id)
      .eq("is_default", true);

  if (policiesError) {
    return NextResponse.json(
      {
        error: "Could not load ListNexus business policies.",
        details: policiesError,
      },
      { status: 500 }
    );
  }

  if (!policies || policies.length !== 3) {
    return NextResponse.json(
      {
        error:
          "ListNexus requires a default PAYMENT, FULFILLMENT, and RETURN policy.",
      },
      { status: 400 }
    );
  }

  const typedPolicies =
    policies as BusinessPolicy[];

  const paymentPolicy =
    typedPolicies.find(
      (policy) =>
        policy.policy_type === "PAYMENT"
    );

  const fulfillmentPolicy =
    typedPolicies.find(
      (policy) =>
        policy.policy_type === "FULFILLMENT"
    );

  const returnPolicy =
    typedPolicies.find(
      (policy) =>
        policy.policy_type === "RETURN"
    );

  if (
    !paymentPolicy ||
    !fulfillmentPolicy ||
    !returnPolicy
  ) {
    return NextResponse.json(
      {
        error:
          "One or more required ListNexus policies are missing.",
      },
      { status: 400 }
    );
  }

  try {
    /*
     * STEP 3:
     * Get a valid eBay access token.
     */
    const accessToken =
      await getEbayAccessToken(user.id);

    const admin = createAdminClient();

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
    };

    /*
     * Helper that saves the relationship:
     *
     * ListNexus policy UUID
     *       ↓
     * eBay policy ID
     */
    async function saveMapping(
      policyId: string,
      externalPolicyId: string
    ) {
      const now = new Date().toISOString();

      const { error } = await admin
        .from("marketplace_policy_mappings")
        .upsert(
          {
            business_policy_id: policyId,
            marketplace: "EBAY",
            environment: "SANDBOX",
            external_policy_id:
              externalPolicyId,
            sync_status: "SYNCED",
            last_synced_at: now,
            updated_at: now,
          },
          {
            onConflict:
              "business_policy_id,marketplace,environment",
          }
        );

      if (error) {
        throw new Error(
          `Could not save marketplace policy mapping: ${error.message}`
        );
      }
    }

    /*
     * Helper that checks whether this ListNexus
     * policy already has an eBay mapping.
     *
     * This makes our test route safer to run again.
     */
    async function getExistingMapping(
      policyId: string
    ) {
      const { data } = await admin
        .from("marketplace_policy_mappings")
        .select("external_policy_id")
        .eq(
          "business_policy_id",
          policyId
        )
        .eq("marketplace", "EBAY")
        .eq("environment", "SANDBOX")
        .maybeSingle();

      return data?.external_policy_id ?? null;
    }

    /*
     * =====================================================
     * PAYMENT POLICY
     * =====================================================
     */

    let paymentPolicyId =
      await getExistingMapping(
        paymentPolicy.id
      );

    if (!paymentPolicyId) {
      const immediatePay =
        paymentPolicy.config
          .requireImmediatePayment === true;

      const response = await fetch(
        "https://api.sandbox.ebay.com/sell/account/v1/payment_policy",
        {
          method: "POST",
          headers,

          body: JSON.stringify({
            name: paymentPolicy.name,

            marketplaceId: "EBAY_US",

            categoryTypes: [
              {
                name:
                  "ALL_EXCLUDING_MOTORS_VEHICLES",
              },
            ],

            immediatePay,
          }),
        }
      );

      const text = await response.text();

      let data: Record<string, unknown> = {};

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(
            `eBay payment policy returned invalid response: ${text}`
          );
        }
      }

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              "Failed to create eBay payment policy.",
            status: response.status,
            details: data,
          },
          { status: response.status }
        );
      }

      paymentPolicyId =
        data.paymentPolicyId as string;

      if (!paymentPolicyId) {
        throw new Error(
          "eBay did not return a paymentPolicyId."
        );
      }

      await saveMapping(
        paymentPolicy.id,
        paymentPolicyId
      );
    }

    /*
     * =====================================================
     * FULFILLMENT / SHIPPING POLICY
     * =====================================================
     */

    let fulfillmentPolicyId =
      await getExistingMapping(
        fulfillmentPolicy.id
      );

    if (!fulfillmentPolicyId) {
      const handlingTimeDays =
        Number(
          fulfillmentPolicy.config
            .handlingTimeDays
        ) || 1;

      const domesticShipping =
        fulfillmentPolicy.config
          .domesticShipping as
          | {
              type?: string;
              carrier?: string;
              service?: string;
            }
          | undefined;

      if (
        !domesticShipping?.carrier ||
        !domesticShipping?.service
      ) {
        throw new Error(
          "The ListNexus fulfillment policy is missing shipping configuration."
        );
      }

      const ebayShippingService =
        getEbayShippingService(
          domesticShipping.carrier,
          domesticShipping.service
        );

      const freeShipping =
        domesticShipping.type === "FREE";

      const response = await fetch(
        "https://api.sandbox.ebay.com/sell/account/v1/fulfillment_policy",
        {
          method: "POST",
          headers,

          body: JSON.stringify({
            name:
              fulfillmentPolicy.name,

            marketplaceId:
              "EBAY_US",

            categoryTypes: [
              {
                name:
                  "ALL_EXCLUDING_MOTORS_VEHICLES",
              },
            ],

            handlingTime: {
              unit: "DAY",
              value:
                handlingTimeDays,
            },

            shippingOptions: [
              {
                optionType:
                  "DOMESTIC",

                costType:
                  "FLAT_RATE",

                shippingServices: [
                    {
                        shippingCarrierCode:
                        domesticShipping.carrier,

                        shippingServiceCode:
                        ebayShippingService,

                        buyerResponsibleForShipping:
                        !freeShipping,

                        freeShipping,
                    },
                ],
              },
            ],
          }),
        }
      );

      const text =
        await response.text();

      let data: Record<string, unknown> = {};

      if (text) {
        try {
          data =
            JSON.parse(text);
        } catch {
          throw new Error(
            `eBay fulfillment policy returned invalid response: ${text}`
          );
        }
      }

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              "Failed to create eBay fulfillment policy.",
            status:
              response.status,
            details:
              data,
          },
          {
            status:
              response.status,
          }
        );
      }

      fulfillmentPolicyId =
        data.fulfillmentPolicyId as string;

      if (!fulfillmentPolicyId) {
        throw new Error(
          "eBay did not return a fulfillmentPolicyId."
        );
      }

      await saveMapping(
        fulfillmentPolicy.id,
        fulfillmentPolicyId
      );
    }

    /*
     * =====================================================
     * RETURN POLICY
     * =====================================================
     */

    let returnPolicyId =
      await getExistingMapping(
        returnPolicy.id
      );

    if (!returnPolicyId) {
      const returnsAccepted =
        returnPolicy.config
          .returnsAccepted === true;

      const returnPeriodDays =
        Number(
          returnPolicy.config
            .returnPeriodDays
        ) || 30;

      const returnShippingPaidBy =
        String(
          returnPolicy.config
            .returnShippingPaidBy ??
            "BUYER"
        );

      const response = await fetch(
        "https://api.sandbox.ebay.com/sell/account/v1/return_policy",
        {
          method: "POST",
          headers,

          body: JSON.stringify({
            name:
              returnPolicy.name,

            marketplaceId:
              "EBAY_US",

            categoryTypes: [
              {
                name:
                  "ALL_EXCLUDING_MOTORS_VEHICLES",
              },
            ],

            returnsAccepted,

            returnPeriod: {
              unit: "DAY",
              value:
                returnPeriodDays,
            },

            returnShippingCostPayer:
              returnShippingPaidBy,
          }),
        }
      );

      const text =
        await response.text();

      let data: Record<string, unknown> = {};

      if (text) {
        try {
          data =
            JSON.parse(text);
        } catch {
          throw new Error(
            `eBay return policy returned invalid response: ${text}`
          );
        }
      }

      if (!response.ok) {
        return NextResponse.json(
          {
            error:
              "Failed to create eBay return policy.",
            status:
              response.status,
            details:
              data,
          },
          {
            status:
              response.status,
          }
        );
      }

      returnPolicyId =
        data.returnPolicyId as string;

      if (!returnPolicyId) {
        throw new Error(
          "eBay did not return a returnPolicyId."
        );
      }

      await saveMapping(
        returnPolicy.id,
        returnPolicyId
      );
    }

    /*
     * STEP 4:
     * Everything is now connected.
     */
    return NextResponse.json({
      success: true,

      message:
        "ListNexus business policies successfully synced to eBay Sandbox.",

      policies: {
        payment: {
          listNexusPolicyId:
            paymentPolicy.id,

          ebayPolicyId:
            paymentPolicyId,
        },

        fulfillment: {
          listNexusPolicyId:
            fulfillmentPolicy.id,

          ebayPolicyId:
            fulfillmentPolicyId,
        },

        return: {
          listNexusPolicyId:
            returnPolicy.id,

          ebayPolicyId:
            returnPolicyId,
        },
      },
    });
  } catch (error) {
    console.error(
      "eBay policy sync error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unknown eBay policy sync error.",
      },
      { status: 500 }
    );
  }
}