import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

const EBAY_API_BASE =
  "https://api.sandbox.ebay.com";

const MARKETPLACE_ID =
  "EBAY_US";

const ENVIRONMENT =
  "SANDBOX";

/*
 * The three eBay trading-card categories that use
 * Graded / Ungraded condition descriptors.
 */
const TRADING_CARD_CATEGORY_IDS =
  new Set([
    "183050",
    "183454",
    "261328",
  ]);

/*
 * Convert eBay numeric condition IDs into the
 * Inventory API condition enum.
 */
function getInventoryCondition(
  conditionId: string
) {
  const conditions: Record<
    string,
    string
  > = {
    "1000": "NEW",
    "1500": "NEW_OTHER",
    "1750": "NEW_WITH_DEFECTS",

    "2000":
      "CERTIFIED_REFURBISHED",

    "2010":
      "EXCELLENT_REFURBISHED",

    "2020":
      "VERY_GOOD_REFURBISHED",

    "2030":
      "GOOD_REFURBISHED",

    "2500":
      "SELLER_REFURBISHED",

    /*
     * For trading cards:
     *
     * 2750 = Graded
     * 4000 = Ungraded
     */
    "2750": "LIKE_NEW",

    "3000":
      "USED_EXCELLENT",

    "4000":
      "USED_VERY_GOOD",

    "5000":
      "USED_GOOD",

    "6000":
      "USED_ACCEPTABLE",

    "7000":
      "FOR_PARTS_OR_NOT_WORKING",
  };

  return (
    conditions[
      conditionId
    ] ?? null
  );
}

/*
 * Convert an eBay API response into JSON safely.
 */
async function readEbayResponse(
  response: Response
) {
  const text =
    await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text,
    };
  }
}

/*
 * Return eBay's best error message.
 */
function getEbayErrorMessage(
  data: any,
  fallback: string
) {
  return (
    data?.errors?.[0]
      ?.longMessage ||
    data?.errors?.[0]
      ?.message ||
    data?.message ||
    fallback
  );
}

/*
 * =====================================================
 * EBAY REQUEST HELPER
 * =====================================================
 */
async function ebayRequest(
  url: string,
  accessToken: string,
  options: {
    method:
      | "GET"
      | "POST"
      | "PUT";

    body?: unknown;
  }
) {
  const headers:
    Record<string, string> =
      {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          "application/json",

        "Accept-Language":
          "en-US",
      };

  /*
   * POST/PUT calls with JSON payloads.
   */
  if (
    options.body !==
    undefined
  ) {
    headers[
      "Content-Type"
    ] =
      "application/json";

    headers[
      "Content-Language"
    ] =
      "en-US";
  }

  const response =
    await fetch(
      url,
      {
        method:
          options.method,

        headers,

        body:
          options.body !==
          undefined
            ? JSON.stringify(
                options.body
              )
            : undefined,
      }
    );

  const data =
    await readEbayResponse(
      response
    );

  if (!response.ok) {
    console.error(
      "eBay API error:",
      response.status,
      data
    );

    throw new Error(
      getEbayErrorMessage(
        data,
        `eBay API request failed with status ${response.status}.`
      )
    );
  }

  return {
    response,
    data,
  };
}

/*
 * =====================================================
 * ROUTE
 * =====================================================
 */

export async function POST(
  request: Request
) {
  /*
   * If we create/update a marketplace_listings row,
   * keep its ID so an error can be recorded.
   */
  let marketplaceListingId:
    string | null =
      null;

  try {
    /*
     * =================================================
     * STEP 1
     * AUTHENTICATE LISTNEXUS USER
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

    /*
     * =================================================
     * STEP 2
     * READ SELLER-SELECTED EBAY SETTINGS
     * =================================================
     */

    const body =
      await request.json();

    const draftId =
      body.draftId
        ?.toString();

    const categoryId =
      body.categoryId
        ?.toString();

    const conditionId =
      body.conditionId
        ?.toString();

    const aspects:
      Record<
        string,
        string
      > =
        body.aspects ??
        {};

    const conditionDescriptors:
      Record<
        string,
        string
      > =
        body.conditionDescriptors ??
        {};

    if (!draftId) {
      return Response.json(
        {
          error:
            "Missing draftId.",
        },
        {
          status: 400,
        }
      );
    }

    if (!categoryId) {
      return Response.json(
        {
          error:
            "Please select an eBay category.",
        },
        {
          status: 400,
        }
      );
    }

    if (!conditionId) {
      return Response.json(
        {
          error:
            "Please select an eBay condition.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 3
     * LOAD APPROVED LISTNEXUS DRAFT
     * =================================================
     */

    const admin =
      createAdminClient();

    const {
      data: draft,
      error: draftError,
    } = await admin
      .from(
        "listing_drafts"
      )
      .select(`
        id,
        product_id,
        user_id,
        generated_title,
        generated_description,
        generated_category,
        generated_condition,
        generated_attributes,
        suggested_price,
        status
      `)
      .eq(
        "id",
        draftId
      )
      .eq(
        "user_id",
        user.id
      )
      .single();

    if (
      draftError ||
      !draft
    ) {
      return Response.json(
        {
          error:
            "Listing draft not found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Never publish an AI draft that has not
     * been seller-approved.
     */
    if (
      draft.status !==
      "APPROVED"
    ) {
      return Response.json(
        {
          error:
            "The listing must be approved before it can be published.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 4
     * LOAD CENTRAL PRODUCT
     * =================================================
     */

    const {
      data: product,
      error: productError,
    } = await admin
      .from("products")
      .select(`
        id,
        sku,
        quantity,
        status,
        price
      `)
      .eq(
        "id",
        draft.product_id
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
            "Central ListNexus product could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      product.quantity <=
      0
    ) {
      return Response.json(
        {
          error:
            "This product is out of stock.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      product.status !==
      "AVAILABLE"
    ) {
      return Response.json(
        {
          error:
            "This product is not currently available for publishing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 5
     * VALIDATE SELLER-APPROVED LISTING
     * =================================================
     */

    const title =
      draft.generated_title
        ?.trim();

    const description =
      draft
        .generated_description
        ?.trim();

    const price =
      Number(
        draft.suggested_price
      );

    if (!title) {
      return Response.json(
        {
          error:
            "The approved listing needs a title.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * eBay listing titles are limited.
     * Do not silently chop off seller-approved text.
     */
    if (
      title.length > 80
    ) {
      return Response.json(
        {
          error:
            "The approved title is longer than eBay's 80-character limit. Shorten the title and approve it again.",
        },
        {
          status: 400,
        }
      );
    }

    if (!description) {
      return Response.json(
        {
          error:
            "The approved listing needs a description.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !Number.isFinite(
        price
      ) ||
      price <= 0
    ) {
      return Response.json(
        {
          error:
            "The approved listing price must be greater than $0.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 6
     * LOAD PRODUCT IMAGES
     * =================================================
     */

    const {
      data: productImages,
      error: imageError,
    } = await admin
      .from(
        "product_images"
      )
      .select(`
        image_url,
        sort_order,
        is_primary
      `)
      .eq(
        "product_id",
        product.id
      )
      .order(
        "sort_order",
        {
          ascending: true,
        }
      );

    if (imageError) {
      console.error(
        imageError
      );

      return Response.json(
        {
          error:
            "ListNexus could not load the product images.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !productImages ||
      productImages.length ===
        0
    ) {
      return Response.json(
        {
          error:
            "At least one product image is required before publishing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Primary image first.
     */
    const sortedImages =
      [
        ...productImages,
      ].sort(
        (a, b) => {
          if (
            a.is_primary &&
            !b.is_primary
          ) {
            return -1;
          }

          if (
            !a.is_primary &&
            b.is_primary
          ) {
            return 1;
          }

          return (
            a.sort_order -
            b.sort_order
          );
        }
      );

    const imageUrls =
      sortedImages.map(
        (image) =>
          image.image_url
      );

    /*
     * =================================================
     * STEP 7
     * BUILD EBAY ITEM SPECIFICS
     * =================================================
     */

    const ebayAspects:
      Record<
        string,
        string[]
      > =
        {};

    for (
      const [
        name,
        value,
      ] of Object.entries(
        aspects
      )
    ) {
      const cleanName =
        name.trim();

      const cleanValue =
        value?.trim();

      if (
        cleanName &&
        cleanValue
      ) {
        ebayAspects[
          cleanName
        ] = [
          cleanValue,
        ];
      }
    }

    if (
      Object.keys(
        ebayAspects
      ).length === 0
    ) {
      return Response.json(
        {
          error:
            "Please complete the required eBay item specifics before publishing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 8
     * VALIDATE CONDITION
     * =================================================
     */

    const inventoryCondition =
      getInventoryCondition(
        conditionId
      );

    if (
      !inventoryCondition
    ) {
      return Response.json(
        {
          error:
            "The selected eBay condition is not supported by ListNexus yet.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Trading cards must use Graded or Ungraded.
     */
    if (
      TRADING_CARD_CATEGORY_IDS.has(
        categoryId
      )
    ) {
      if (
        conditionId !==
          "2750" &&
        conditionId !==
          "4000"
      ) {
        return Response.json(
          {
            error:
              "Trading cards must use either Graded or Ungraded condition on eBay.",
          },
          {
            status: 400,
          }
        );
      }

      /*
       * Ungraded:
       * Card Condition descriptor is required.
       */
      if (
        conditionId ===
          "4000" &&
        !conditionDescriptors[
          "40001"
        ]
      ) {
        return Response.json(
          {
            error:
              "Please select the card condition for this ungraded card.",
          },
          {
            status: 400,
          }
        );
      }

      /*
       * Graded:
       * Professional Grader + Grade required.
       */
      if (
        conditionId ===
        "2750"
      ) {
        if (
          !conditionDescriptors[
            "27501"
          ] ||
          !conditionDescriptors[
            "27502"
          ]
        ) {
          return Response.json(
            {
              error:
                "A graded card requires both Professional Grader and Grade.",
            },
            {
              status: 400,
            }
          );
        }
      }
    }

    /*
     * Convert frontend descriptor selections into
     * Inventory API conditionDescriptors.
     */
    const ebayConditionDescriptors:
      any[] =
        [];

    for (
      const [
        descriptorId,
        value,
      ] of Object.entries(
        conditionDescriptors
      )
    ) {
      const cleanValue =
        value?.trim();

      if (!cleanValue) {
        continue;
      }

      /*
       * Trading-card certification number is
       * open text rather than a numeric value ID.
       */
      if (
        descriptorId ===
        "27503"
      ) {
        ebayConditionDescriptors.push(
          {
            name:
              descriptorId,

            additionalInfo:
              cleanValue,
          }
        );
      } else {
        ebayConditionDescriptors.push(
          {
            name:
              descriptorId,

            values: [
              cleanValue,
            ],
          }
        );
      }
    }

    /*
     * =================================================
     * STEP 9
     * GET DEFAULT LISTNEXUS LOCATION MAPPING
     * =================================================
     */

    const {
      data: locations,
      error: locationError,
    } = await admin
      .from("locations")
      .select(`
        id,
        name
      `)
      .eq(
        "user_id",
        user.id
      )
      .eq(
        "is_default",
        true
      )
      .limit(1);

    if (
      locationError ||
      !locations ||
      locations.length ===
        0
    ) {
      return Response.json(
        {
          error:
            "ListNexus does not have a default inventory location for this user.",
        },
        {
          status: 400,
        }
      );
    }

    const centralLocation =
      locations[0];

    const {
      data:
        locationMappings,
      error:
        locationMappingError,
    } = await admin
      .from(
        "marketplace_locations"
      )
      .select(`
        external_location_id,
        sync_status
      `)
      .eq(
        "location_id",
        centralLocation.id
      )
      .eq(
        "marketplace",
        "EBAY"
      )
      .eq(
        "environment",
        ENVIRONMENT
      )
      .limit(1);

    if (
      locationMappingError ||
      !locationMappings ||
      locationMappings.length ===
        0
    ) {
      return Response.json(
        {
          error:
            "The default ListNexus location has not been synced to eBay Sandbox.",
        },
        {
          status: 400,
        }
      );
    }

    const locationMapping =
      locationMappings[0];

    if (
      locationMapping.sync_status !==
        "SYNCED" ||
      !locationMapping.external_location_id
    ) {
      return Response.json(
        {
          error:
            "The eBay Sandbox inventory location is not ready.",
        },
        {
          status: 400,
        }
      );
    }

    const merchantLocationKey =
      locationMapping.external_location_id;

    /*
     * =================================================
     * STEP 10
     * LOAD DEFAULT BUSINESS POLICIES
     * =================================================
     */

    const {
      data: policies,
      error: policyError,
    } = await admin
      .from(
        "business_policies"
      )
      .select(`
        id,
        policy_type
      `)
      .eq(
        "user_id",
        user.id
      )
      .eq(
        "is_default",
        true
      )
      .in(
        "policy_type",
        [
          "PAYMENT",
          "FULFILLMENT",
          "RETURN",
        ]
      );

    if (
      policyError ||
      !policies
    ) {
      return Response.json(
        {
          error:
            "ListNexus could not load the default business policies.",
        },
        {
          status: 500,
        }
      );
    }

    const policyByType =
      new Map<
        string,
        any
      >();

    for (
      const policy of
        policies
    ) {
      policyByType.set(
        policy.policy_type,
        policy
      );
    }

    const paymentPolicy =
      policyByType.get(
        "PAYMENT"
      );

    const fulfillmentPolicy =
      policyByType.get(
        "FULFILLMENT"
      );

    const returnPolicy =
      policyByType.get(
        "RETURN"
      );

    if (
      !paymentPolicy ||
      !fulfillmentPolicy ||
      !returnPolicy
    ) {
      return Response.json(
        {
          error:
            "Payment, fulfillment, and return policies are all required before publishing.",
        },
        {
          status: 400,
        }
      );
    }

    const policyIds = [
      paymentPolicy.id,
      fulfillmentPolicy.id,
      returnPolicy.id,
    ];

    const {
      data: policyMappings,
      error:
        policyMappingError,
    } = await admin
      .from(
        "marketplace_policy_mappings"
      )
      .select(`
        business_policy_id,
        external_policy_id,
        sync_status
      `)
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
        ENVIRONMENT
      );

    if (
      policyMappingError ||
      !policyMappings
    ) {
      return Response.json(
        {
          error:
            "ListNexus could not load the eBay policy mappings.",
        },
        {
          status: 500,
        }
      );
    }

    const mappingByPolicy =
      new Map<
        string,
        any
      >();

    for (
      const mapping of
        policyMappings
    ) {
      mappingByPolicy.set(
        mapping.business_policy_id,
        mapping
      );
    }

    const paymentMapping =
      mappingByPolicy.get(
        paymentPolicy.id
      );

    const fulfillmentMapping =
      mappingByPolicy.get(
        fulfillmentPolicy.id
      );

    const returnMapping =
      mappingByPolicy.get(
        returnPolicy.id
      );

    if (
      !paymentMapping
        ?.external_policy_id ||
      !fulfillmentMapping
        ?.external_policy_id ||
      !returnMapping
        ?.external_policy_id
    ) {
      return Response.json(
        {
          error:
            "One or more ListNexus business policies have not been synced to eBay Sandbox.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =================================================
     * STEP 11
     * CHECK MARKETPLACE LISTING RECORD
     * =================================================
     */

    const {
      data:
        existingListings,
      error:
        existingListingError,
    } = await admin
      .from(
        "marketplace_listings"
      )
      .select(`
        id,
        external_offer_id,
        external_listing_id,
        status
      `)
      .eq(
        "product_id",
        product.id
      )
      .eq(
        "marketplace",
        "EBAY"
      )
      .eq(
        "environment",
        ENVIRONMENT
      )
      .limit(1);

    if (
      existingListingError
    ) {
      console.error(
        existingListingError
      );

      return Response.json(
        {
          error:
            "ListNexus could not check the existing marketplace listing.",
        },
        {
          status: 500,
        }
      );
    }

    const existingListing =
      existingListings?.[0] ??
      null;

    /*
     * Do not accidentally create a second listing
     * when this product is already ACTIVE.
     */
    if (
      existingListing
        ?.status ===
        "ACTIVE" &&
      existingListing
        ?.external_listing_id
    ) {
      return Response.json(
        {
          error:
            "This product is already published to eBay Sandbox.",

          listingId:
            existingListing
              .external_listing_id,
        },
        {
          status: 409,
        }
      );
    }

    /*
     * =================================================
     * STEP 12
     * CREATE/UPDATE LOCAL PENDING RECORD
     * =================================================
     */

    const pendingPayload =
      {
        product_id:
          product.id,

        marketplace:
          "EBAY",

        environment:
          ENVIRONMENT,

        external_category_id:
          categoryId,

        price,

        quantity:
          product.quantity,

        status:
          "PENDING",

        last_synced_at:
          new Date().toISOString(),
      };

    if (existingListing) {
      const {
        error:
          pendingUpdateError,
      } = await admin
        .from(
          "marketplace_listings"
        )
        .update(
          pendingPayload
        )
        .eq(
          "id",
          existingListing.id
        );

      if (
        pendingUpdateError
      ) {
        throw new Error(
          "ListNexus could not mark the marketplace listing as pending."
        );
      }

      marketplaceListingId =
        existingListing.id;
    } else {
      const {
        data:
          newMarketplaceListing,
        error:
          pendingInsertError,
      } = await admin
        .from(
          "marketplace_listings"
        )
        .insert(
          pendingPayload
        )
        .select("id")
        .single();

      if (
        pendingInsertError ||
        !newMarketplaceListing
      ) {
        console.error(
          pendingInsertError
        );

        throw new Error(
          "ListNexus could not create the marketplace listing record."
        );
      }

      marketplaceListingId =
        newMarketplaceListing.id;
    }

    /*
     * =================================================
     * STEP 13
     * GET VALID EBAY OAUTH TOKEN
     * =================================================
     */

    const accessToken =
      await getEbayAccessToken(
        user.id
      );

    /*
     * =================================================
     * STEP 14
     * CREATE/REPLACE EBAY INVENTORY ITEM
     * =================================================
     *
     * This replaces the old hardcoded Sandbox test
     * item with the seller-approved ListNexus data.
     */

    const inventoryItemBody:
      any =
        {
          availability: {
            shipToLocationAvailability:
              {
                quantity:
                  product.quantity,
              },
          },

          condition:
            inventoryCondition,

          product: {
            title,

            description,

            aspects:
              ebayAspects,

            imageUrls,
          },
        };

    /*
     * Condition descriptors are required for the
     * trading-card grading system.
     *
     * eBay says conditionDescription should not be
     * combined with conditionDescriptors.
     */
    if (
      ebayConditionDescriptors.length >
      0
    ) {
      inventoryItemBody.conditionDescriptors =
        ebayConditionDescriptors;
    }

    const inventoryItemUrl =
      `${EBAY_API_BASE}` +
      `/sell/inventory/v1/inventory_item/` +
      `${encodeURIComponent(
        product.sku
      )}`;

    await ebayRequest(
      inventoryItemUrl,
      accessToken,
      {
        method:
          "PUT",

        body:
          inventoryItemBody,
      }
    );

    /*
     * =================================================
     * STEP 15
     * BUILD EBAY OFFER
     * =================================================
     */

    const offerBody =
      {
        sku:
          product.sku,

        marketplaceId:
          MARKETPLACE_ID,

        format:
          "FIXED_PRICE",

        availableQuantity:
          product.quantity,

        categoryId,

        merchantLocationKey,

        listingDescription:
          description,

        listingDuration:
          "GTC",

        /*
         * Keep our seller-reviewed ListNexus product
         * information rather than allowing catalog
         * details to silently replace it.
         */
        includeCatalogProductDetails:
          false,

        listingPolicies: {
          paymentPolicyId:
            paymentMapping
              .external_policy_id,

          fulfillmentPolicyId:
            fulfillmentMapping
              .external_policy_id,

          returnPolicyId:
            returnMapping
              .external_policy_id,
        },

        pricingSummary: {
          price: {
            currency:
              "USD",

            value:
              price.toFixed(
                2
              ),
          },
        },
      };

    /*
     * =================================================
     * STEP 16
     * CREATE OR UPDATE EBAY OFFER
     * =================================================
     */

    let offerId =
      existingListing
        ?.external_offer_id ??
      null;

    if (offerId) {
      /*
       * A previous attempt created the offer but did
       * not successfully publish it.
       *
       * Update the existing offer instead of creating
       * duplicates.
       */
      const updateOfferUrl =
        `${EBAY_API_BASE}` +
        `/sell/inventory/v1/offer/` +
        `${encodeURIComponent(
          offerId
        )}`;

      await ebayRequest(
        updateOfferUrl,
        accessToken,
        {
          method:
            "PUT",

          body:
            offerBody,
        }
      );
    } else {
      const createOfferUrl =
        `${EBAY_API_BASE}` +
        `/sell/inventory/v1/offer`;

      const {
        response:
          createOfferResponse,

        data:
          createOfferData,
      } =
        await ebayRequest(
          createOfferUrl,
          accessToken,
          {
            method:
              "POST",

            body:
              offerBody,
          }
        );

      /*
       * Successful createOffer normally returns offerId
       * in the response payload.
       *
       * Location header is kept as a fallback.
       */
      offerId =
        createOfferData
          ?.offerId ??
        null;

      if (!offerId) {
        const locationHeader =
          createOfferResponse.headers.get(
            "location"
          );

        if (
          locationHeader
        ) {
          const parts =
            locationHeader
              .split("/")
              .filter(
                Boolean
              );

          offerId =
            parts[
              parts.length -
                1
            ];
        }
      }

      if (!offerId) {
        throw new Error(
          "eBay created the offer but did not return an offer ID."
        );
      }
    }

    /*
     * Save offer ID BEFORE publishing.
     *
     * If publish fails, ListNexus can safely retry
     * using the same offer.
     */
    await admin
      .from(
        "marketplace_listings"
      )
      .update({
        external_offer_id:
          offerId,

        external_category_id:
          categoryId,

        status:
          "PENDING",

        last_synced_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        marketplaceListingId
      );

    /*
     * =================================================
     * STEP 17
     * PUBLISH THE OFFER
     * =================================================
     *
     * THIS CALL CREATES THE ACTIVE EBAY SANDBOX LISTING.
     */

    const publishUrl =
      `${EBAY_API_BASE}` +
      `/sell/inventory/v1/offer/` +
      `${encodeURIComponent(
        offerId
      )}` +
      `/publish`;

    const {
      data:
        publishData,
    } =
      await ebayRequest(
        publishUrl,
        accessToken,
        {
          method:
            "POST",
        }
      );

    const listingId =
      publishData
        ?.listingId;

    if (!listingId) {
      throw new Error(
        "eBay published the offer but did not return a listing ID."
      );
    }

    /*
     * Sandbox View Item URL.
     */
    const listingUrl =
      `https://sandbox.ebay.com/itm/${listingId}`;

    /*
     * =================================================
     * STEP 18
     * MARK MARKETPLACE LISTING ACTIVE
     * =================================================
     */

    const {
      error:
        activeUpdateError,
    } = await admin
      .from(
        "marketplace_listings"
      )
      .update({
        external_offer_id:
          offerId,

        external_listing_id:
          listingId,

        external_category_id:
          categoryId,

        listing_url:
          listingUrl,

        price,

        quantity:
          product.quantity,

        status:
          "ACTIVE",

        last_synced_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        marketplaceListingId
      );

    if (
      activeUpdateError
    ) {
      /*
       * The eBay listing itself exists at this point,
       * so do NOT claim publishing failed.
       */
      console.error(
        "eBay listing published but local database update failed:",
        activeUpdateError
      );

      return Response.json(
        {
          success: true,

          warning:
            "The eBay Sandbox listing was published, but ListNexus could not fully update its local marketplace record.",

          published:
            true,

          offerId,

          listingId,

          listingUrl,
        }
      );
    }

    /*
     * =================================================
     * SUCCESS
     * =================================================
     */

    return Response.json({
      success: true,

      published: true,

      message:
        "Listing published successfully to eBay Sandbox.",

      marketplace:
        "EBAY",

      environment:
        ENVIRONMENT,

      product: {
        id:
          product.id,

        sku:
          product.sku,

        quantity:
          product.quantity,
      },

      ebay: {
        categoryId,

        conditionId,

        inventoryCondition,

        offerId,

        listingId,

        listingUrl,
      },
    });
  } catch (error) {
    console.error(
      "eBay publish error:",
      error
    );

    /*
     * If ListNexus had already created a marketplace
     * record, mark the operation ERROR.
     */
    if (
      marketplaceListingId
    ) {
      try {
        const admin =
          createAdminClient();

        await admin
          .from(
            "marketplace_listings"
          )
          .update({
            status:
              "ERROR",

            last_synced_at:
              new Date().toISOString(),
          })
          .eq(
            "id",
            marketplaceListingId
          );
      } catch (
        databaseError
      ) {
        console.error(
          "Could not mark marketplace listing as ERROR:",
          databaseError
        );
      }
    }

    return Response.json(
      {
        success: false,

        published: false,

        error:
          error instanceof Error
            ? error.message
            : "Failed to publish the listing to eBay Sandbox.",
      },
      {
        status: 500,
      }
    );
  }
}