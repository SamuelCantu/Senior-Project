import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * eBay's official Event Notification SDK.
 *
 * It does not currently ship TypeScript declarations,
 * so we load the CommonJS package directly.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EventNotificationSDK =
  require("event-notification-nodejs-sdk");

export const runtime = "nodejs";

const ENVIRONMENT =
  "PRODUCTION";

const verificationToken =
  process.env
    .EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;

const endpoint =
  process.env
    .EBAY_ACCOUNT_DELETION_ENDPOINT;

/*
 * =====================================================
 * EBAY SDK CONFIGURATION
 * =====================================================
 *
 * IMPORTANT:
 *
 * These must be PRODUCTION credentials.
 * Do not use the existing Sandbox credentials here.
 */

function getEbayNotificationConfig() {
  const clientId =
    process.env
      .EBAY_PRODUCTION_CLIENT_ID;

  const clientSecret =
    process.env
      .EBAY_PRODUCTION_CLIENT_SECRET;

  const devId =
    process.env
      .EBAY_PRODUCTION_DEV_ID;

  const redirectUri =
    process.env
      .EBAY_PRODUCTION_REDIRECT_URI;

  if (
    !clientId ||
    !clientSecret ||
    !devId ||
    !redirectUri ||
    !verificationToken ||
    !endpoint
  ) {
    throw new Error(
      "eBay Production notification configuration is incomplete."
    );
  }

  return {
    PRODUCTION: {
      clientId,
      clientSecret,
      devId,
      redirectUri,

      /*
       * eBay SDK expects hostname only here.
       */
      baseUrl:
        "api.ebay.com",

      environment:
        "PRODUCTION",
    },

    endpoint,

    verificationToken,
  };
}

/*
 * =====================================================
 * GET
 *
 * EBAY ENDPOINT OWNERSHIP VERIFICATION
 * =====================================================
 */

export async function GET(
  request: Request
) {
  try {
    if (
      !verificationToken ||
      !endpoint
    ) {
      return Response.json(
        {
          error:
            "Webhook configuration is incomplete.",
        },
        {
          status: 500,
        }
      );
    }

    const url =
      new URL(request.url);

    const challengeCode =
      url.searchParams.get(
        "challenge_code"
      );

    if (!challengeCode) {
      return Response.json(
        {
          error:
            "Missing challenge_code.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * eBay requires:
     *
     * challengeCode
     * + verificationToken
     * + endpoint
     *
     * SHA-256 -> hexadecimal
     */
    const hash =
      createHash("sha256");

    hash.update(
      challengeCode
    );

    hash.update(
      verificationToken
    );

    hash.update(
      endpoint
    );

    const challengeResponse =
      hash.digest("hex");

    return Response.json(
      {
        challengeResponse,
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "eBay endpoint verification error:",
      error
    );

    return Response.json(
      {
        error:
          "Could not verify eBay endpoint.",
      },
      {
        status: 500,
      }
    );
  }
}

/*
 * =====================================================
 * DATABASE HELPERS
 * =====================================================
 */

async function deleteMarketplaceListings(
  admin: ReturnType<
    typeof createAdminClient
  >,
  productIds: string[]
) {
  if (
    productIds.length ===
    0
  ) {
    return;
  }

  const {
    error,
  } = await admin
    .from(
      "marketplace_listings"
    )
    .delete()
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
      "PRODUCTION"
    );

  if (error) {
    throw new Error(
      `Could not delete eBay marketplace listings: ${error.message}`
    );
  }
}

async function deleteMarketplaceLocations(
  admin: ReturnType<
    typeof createAdminClient
  >,
  locationIds: string[]
) {
  if (
    locationIds.length ===
    0
  ) {
    return;
  }

  const {
    error,
  } = await admin
    .from(
      "marketplace_locations"
    )
    .delete()
    .in(
      "location_id",
      locationIds
    )
    .eq(
      "marketplace",
      "EBAY"
    )
    .eq(
      "environment",
      "PRODUCTION"
    );

  if (error) {
    throw new Error(
      `Could not delete eBay location mappings: ${error.message}`
    );
  }
}

async function deleteMarketplacePolicyMappings(
  admin: ReturnType<
    typeof createAdminClient
  >,
  policyIds: string[]
) {
  if (
    policyIds.length ===
    0
  ) {
    return;
  }

  const {
    error,
  } = await admin
    .from(
      "marketplace_policy_mappings"
    )
    .delete()
    .in(
      "business_policy_id",
      policyIds
    )
    .eq(
      "marketplace",
      "EBAY"
    )
    .eq(
      "environment",
      "PRODUCTION"
    );

  if (error) {
    throw new Error(
      `Could not delete eBay policy mappings: ${error.message}`
    );
  }
}

/*
 * =====================================================
 * FIND EBAY ACCOUNT
 * =====================================================
 */

async function findEbayAccount(
  ebayUserId:
    string | null,

  eiasToken:
    string | null
) {
  const admin =
    createAdminClient();

  /*
   * Prefer the immutable eBay user ID.
   */
  if (ebayUserId) {
    const {
      data,
      error,
    } = await admin
      .from(
        "marketplace_accounts"
      )
      .select(`
        id,
        user_id,
        marketplace,
        environment
      `)
      .eq(
        "marketplace",
        "EBAY"
      )
      .eq(
        "environment",
        "PRODUCTION"
      )
      .eq(
        "external_user_id",
        ebayUserId
      )
      .maybeSingle();

    if (error) {
      throw new Error(
        `Could not search eBay accounts: ${error.message}`
      );
    }

    if (data) {
      return data;
    }
  }

  /*
   * EIAS token is our fallback identifier.
   */
  if (eiasToken) {
    const {
      data,
      error,
    } = await admin
      .from(
        "marketplace_accounts"
      )
      .select(`
        id,
        user_id,
        marketplace,
        environment
      `)
      .eq(
        "marketplace",
        "EBAY"
      )
      .eq(
        "environment",
        "PRODUCTION"
      )
      .eq(
        "eias_token",
        eiasToken
      )
      .maybeSingle();

    if (error) {
      throw new Error(
        `Could not search eBay accounts: ${error.message}`
      );
    }

    if (data) {
      return data;
    }
  }

  return null;
}

/*
 * =====================================================
 * DELETE EBAY DATA FOR LISTNEXUS USER
 * =====================================================
 *
 * IMPORTANT:
 *
 * We do NOT delete:
 *
 * - the ListNexus user
 * - their central products
 * - their AI drafts
 * - their central locations
 * - their central business policies
 *
 * Those belong to ListNexus.
 *
 * We delete only the eBay Production connection
 * and eBay-specific marketplace mappings/data.
 */

async function deleteEbayUserData(
  accountId: string,
  userId: string
) {
  const admin =
    createAdminClient();

  /*
   * ===================================================
   * PRODUCTS OWNED BY THIS LISTNEXUS USER
   * ===================================================
   */

  const {
    data: products,
    error: productsError,
  } = await admin
    .from("products")
    .select("id")
    .eq(
      "user_id",
      userId
    );

  if (productsError) {
    throw new Error(
      `Could not load products for deletion: ${productsError.message}`
    );
  }

  const productIds =
    (
      products ??
      []
    ).map(
      (product) =>
        product.id
    );

  /*
   * ===================================================
   * LOCATIONS OWNED BY USER
   * ===================================================
   */

  const {
    data: locations,
    error: locationsError,
  } = await admin
    .from("locations")
    .select("id")
    .eq(
      "user_id",
      userId
    );

  if (locationsError) {
    throw new Error(
      `Could not load locations for deletion: ${locationsError.message}`
    );
  }

  const locationIds =
    (
      locations ??
      []
    ).map(
      (location) =>
        location.id
    );

  /*
   * ===================================================
   * BUSINESS POLICIES OWNED BY USER
   * ===================================================
   */

  const {
    data: policies,
    error: policiesError,
  } = await admin
    .from(
      "business_policies"
    )
    .select("id")
    .eq(
      "user_id",
      userId
    );

  if (policiesError) {
    throw new Error(
      `Could not load business policies for deletion: ${policiesError.message}`
    );
  }

  const policyIds =
    (
      policies ??
      []
    ).map(
      (policy) =>
        policy.id
    );

  /*
   * ===================================================
   * DELETE EBAY-SPECIFIC DATA
   * ===================================================
   */

  await deleteMarketplaceListings(
    admin,
    productIds
  );

  await deleteMarketplaceLocations(
    admin,
    locationIds
  );

  await deleteMarketplacePolicyMappings(
    admin,
    policyIds
  );

  /*
   * ===================================================
   * DELETE EBAY OAUTH ACCOUNT LAST
   * ===================================================
   *
   * This permanently removes:
   *
   * access token
   * refresh token
   * token expirations
   * eBay account identifiers
   * eBay connection metadata
   */

  const {
    error:
      accountDeleteError,
  } = await admin
    .from(
      "marketplace_accounts"
    )
    .delete()
    .eq(
      "id",
      accountId
    )
    .eq(
      "marketplace",
      "EBAY"
    )
    .eq(
      "environment",
      "PRODUCTION"
    );

  if (
    accountDeleteError
  ) {
    throw new Error(
      `Could not delete eBay account connection: ${accountDeleteError.message}`
    );
  }
}

/*
 * =====================================================
 * POST
 *
 * EBAY MARKETPLACE ACCOUNT DELETION NOTIFICATION
 * =====================================================
 */

export async function POST(
  request: Request
) {
  try {
    /*
     * =================================================
     * STEP 1
     * REQUIRE EBAY SIGNATURE
     * =================================================
     */

    const signature =
      request.headers.get(
        "x-ebay-signature"
      );

    if (!signature) {
      console.error(
        "Rejected eBay deletion notification: missing signature."
      );

      return new Response(
        null,
        {
          status: 412,
        }
      );
    }

    /*
     * =================================================
     * STEP 2
     * READ JSON BODY
     * =================================================
     */

    const rawBody =
      await request.text();

    if (!rawBody) {
      return Response.json(
        {
          error:
            "Missing notification payload.",
        },
        {
          status: 400,
        }
      );
    }

    let payload: any;

    try {
      payload =
        JSON.parse(
          rawBody
        );
    } catch {
      return Response.json(
        {
          error:
            "Invalid JSON payload.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 3
     * CONFIRM TOPIC
     * =================================================
     */

    if (
      payload
        ?.metadata
        ?.topic !==
      "MARKETPLACE_ACCOUNT_DELETION"
    ) {
      /*
       * This endpoint is only for account deletion.
       */
      return new Response(
        null,
        {
          status: 204,
        }
      );
    }

    /*
     * =================================================
     * STEP 4
     * VERIFY THAT EBAY SIGNED THIS MESSAGE
     * =================================================
     *
     * eBay's SDK:
     *
     * - decodes X-EBAY-SIGNATURE
     * - extracts key ID
     * - retrieves eBay's public key
     * - caches that key
     * - validates the ECC signature
     */

    const config =
      getEbayNotificationConfig();

    const verificationStatus =
      await EventNotificationSDK.process(
        payload,
        signature,
        config,
        ENVIRONMENT
      );

    /*
     * eBay SDK returns:
     *
     * 204 -> signature valid
     * 412 -> signature invalid
     */

    if (
      verificationStatus !==
      204
    ) {
      console.error(
        "Rejected eBay account deletion notification because signature verification failed."
      );

      return new Response(
        null,
        {
          status:
            verificationStatus ||
            412,
        }
      );
    }

    /*
     * =================================================
     * STEP 5
     * GET EBAY IDENTIFIERS
     * =================================================
     */

    const ebayUserId =
      payload
        ?.notification
        ?.data
        ?.userId ??
      null;

    const eiasToken =
      payload
        ?.notification
        ?.data
        ?.eiasToken ??
      null;

    const notificationId =
      payload
        ?.notification
        ?.notificationId ??
      "unknown";

    /*
     * Never log the eBay user ID, username,
     * EIAS token, access token, etc.
     */
    console.log(
      `Verified eBay account deletion notification ${notificationId}.`
    );

    if (
      !ebayUserId &&
      !eiasToken
    ) {
      /*
       * This should not happen with a valid eBay
       * account-deletion payload. Returning 500 lets
       * eBay retry instead of silently losing it.
       */
      console.error(
        "Verified eBay deletion notification did not contain a usable account identifier."
      );

      return new Response(
        null,
        {
          status: 500,
        }
      );
    }

    /*
     * =================================================
     * STEP 6
     * FIND MATCHING LISTNEXUS EBAY CONNECTION
     * =================================================
     */

    const account =
      await findEbayAccount(
        ebayUserId,
        eiasToken
      );

    /*
     * Test notifications and already-processed
     * retries may not match a real account.
     *
     * Acknowledge them safely.
     */
    if (!account) {
      console.log(
        `Verified eBay deletion notification ${notificationId}; no matching Production ListNexus eBay account was found.`
      );

      return new Response(
        null,
        {
          status: 204,
        }
      );
    }

    /*
     * =================================================
     * STEP 7
     * PERMANENTLY DELETE EBAY-SPECIFIC DATA
     * =================================================
     */

    await deleteEbayUserData(
      account.id,
      account.user_id
    );

    console.log(
      `Completed eBay account deletion notification ${notificationId}.`
    );

    /*
     * =================================================
     * STEP 8
     * ACKNOWLEDGE EBAY
     * =================================================
     */

    return new Response(
      null,
      {
        status: 204,
      }
    );
  } catch (error) {
    console.error(
      "eBay account deletion webhook processing failed:",
      error
    );

    /*
     * Returning 500 causes eBay to retry rather than
     * incorrectly treating an incomplete deletion as
     * successful.
     */
    return Response.json(
      {
        error:
          "Could not process eBay account deletion notification.",
      },
      {
        status: 500,
      }
    );
  }
}