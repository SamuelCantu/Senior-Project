import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEbayAccessToken } from "@/lib/ebay/getAccessToken";

const EBAY_API_BASE =
  "https://api.sandbox.ebay.com";

const MARKETPLACE_ID =
  "EBAY_US";

/*
 * eBay collectible-card categories where new listings
 * must use Graded or Ungraded condition grading.
 */
const TRADING_CARD_CATEGORY_IDS =
  new Set([
    "183050",
    "183454",
    "261328",
  ]);

/*
 * Convert eBay's numeric condition ID into the
 * Inventory API text enum.
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
    "2000": "CERTIFIED_REFURBISHED",
    "2010": "EXCELLENT_REFURBISHED",
    "2020": "VERY_GOOD_REFURBISHED",
    "2030": "GOOD_REFURBISHED",
    "2500": "SELLER_REFURBISHED",

    /*
     * Trading cards:
     *
     * 2750 = Graded
     * 4000 = Ungraded
     */
    "2750": "LIKE_NEW",
    "3000": "USED_EXCELLENT",
    "4000": "USED_VERY_GOOD",

    "5000": "USED_GOOD",
    "6000": "USED_ACCEPTABLE",
    "7000":
      "FOR_PARTS_OR_NOT_WORKING",
  };

  return (
    conditions[conditionId] ??
    null
  );
}

/*
 * Helper for authenticated eBay GET requests.
 */
async function getEbayJson(
  url: string,
  accessToken: string
) {
  const response =
    await fetch(url, {
      method: "GET",

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          "application/json",

        "Accept-Language":
          "en-US",
      },
    });

  const responseText =
    await response.text();

  let data: any = {};

  if (responseText) {
    try {
      data =
        JSON.parse(
          responseText
        );
    } catch {
      data = {
        raw:
          responseText,
      };
    }
  }

  if (!response.ok) {
    console.error(
      "eBay API error:",
      response.status,
      data
    );

    throw new Error(
      data?.errors?.[0]
        ?.longMessage ||
        data?.errors?.[0]
          ?.message ||
        data?.message ||
        `eBay API request failed with status ${response.status}.`
    );
  }

  return data;
}

export async function POST(
  request: Request
) {
  try {
    /*
     * =====================================================
     * STEP 1
     * Logged-in ListNexus user.
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
     * Get the approved draft ID.
     *
     * categoryId is optional.
     *
     * If the seller picks another eBay category from
     * the preview, the frontend can send it here and
     * we will reload that category's requirements.
     * =====================================================
     */
    const body =
      await request.json();

    const draftId =
      body.draftId?.toString();

    const requestedCategoryId =
      body.categoryId
        ?.toString();

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

    const admin =
      createAdminClient();

    /*
     * =====================================================
     * STEP 3
     * Load seller-approved listing.
     * =====================================================
     */
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
            "Approved listing draft not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      draft.status !==
      "APPROVED"
    ) {
      return Response.json(
        {
          error:
            "The listing must be approved before preparing it for eBay.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * STEP 4
     * Load central inventory product.
     * =====================================================
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
            "The centralized product could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      product.quantity <= 0
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
            "This product is not currently available for marketplace publishing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * STEP 5
     * Get valid eBay Sandbox OAuth token.
     * =====================================================
     */
    const accessToken =
      await getEbayAccessToken(
        user.id
      );

    /*
     * =====================================================
     * STEP 6
     * Get the EBAY_US category tree.
     * =====================================================
     */
    const categoryTreeUrl =
      `${EBAY_API_BASE}` +
      `/commerce/taxonomy/v1/get_default_category_tree_id` +
      `?marketplace_id=${MARKETPLACE_ID}`;

    const categoryTree =
      await getEbayJson(
        categoryTreeUrl,
        accessToken
      );

    const categoryTreeId =
      categoryTree.categoryTreeId;

    if (!categoryTreeId) {
      throw new Error(
        "eBay did not return a category tree ID."
      );
    }

    /*
     * =====================================================
     * STEP 7
     * Ask eBay for category suggestions.
     * =====================================================
     */
    const categoryQuery =
      draft.generated_title;

    const categorySuggestionUrl =
      `${EBAY_API_BASE}` +
      `/commerce/taxonomy/v1/category_tree/` +
      `${encodeURIComponent(
        categoryTreeId
      )}` +
      `/get_category_suggestions` +
      `?q=${encodeURIComponent(
        categoryQuery
      )}`;

    const categorySuggestionData =
      await getEbayJson(
        categorySuggestionUrl,
        accessToken
      );

    const suggestions =
      categorySuggestionData
        .categorySuggestions ??
      [];

    if (
      suggestions.length === 0
    ) {
      return Response.json(
        {
          error:
            "eBay could not determine an appropriate category for this listing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Create clean category choices.
     */
    const categoryAlternatives =
      suggestions
        .slice(0, 5)
        .map(
          (
            suggestion: any
          ) => ({
            categoryId:
              String(
                suggestion
                  ?.category
                  ?.categoryId ??
                  ""
              ),

            categoryName:
              suggestion
                ?.category
                ?.categoryName ??
              "",
          })
        )
        .filter(
          (category: any) =>
            category.categoryId &&
            category.categoryName
        );

    /*
     * Default to eBay's first recommendation.
     */
    let selectedCategory =
      categoryAlternatives[0];

    /*
     * If seller chose another category from our
     * suggestions, use that instead.
     */
    if (
      requestedCategoryId
    ) {
      const requested =
        categoryAlternatives.find(
          (category: any) =>
            category.categoryId ===
            requestedCategoryId
        );

      if (!requested) {
        return Response.json(
          {
            error:
              "The selected eBay category is not available for this listing.",
          },
          {
            status: 400,
          }
        );
      }

      selectedCategory =
        requested;
    }

    const categoryId =
      selectedCategory.categoryId;

    /*
     * =====================================================
     * STEP 8
     * Load item-specific/aspect requirements.
     * =====================================================
     */
    const aspectsUrl =
      `${EBAY_API_BASE}` +
      `/commerce/taxonomy/v1/category_tree/` +
      `${encodeURIComponent(
        categoryTreeId
      )}` +
      `/get_item_aspects_for_category` +
      `?category_id=${encodeURIComponent(
        categoryId
      )}`;

    const aspectsData =
      await getEbayJson(
        aspectsUrl,
        accessToken
      );

    const aspects =
      aspectsData.aspects ??
      [];

    /*
     * For now, surface required aspects.
     *
     * IMPORTANT:
     * We no longer trim the allowed values.
     * This lets the seller find things such as Pokémon
     * even if they are farther down eBay's list.
     */
    const requiredAspects =
      aspects
        .filter(
          (aspect: any) =>
            aspect
              ?.aspectConstraint
              ?.aspectRequired ===
            true
        )
        .map(
          (aspect: any) => ({
            name:
              aspect
                .localizedAspectName,

            mode:
              aspect
                ?.aspectConstraint
                ?.aspectMode ??
              null,

            values:
              (
                aspect
                  ?.aspectValues ??
                []
              )
                .map(
                  (
                    value: any
                  ) =>
                    value
                      ?.localizedValue
                )
                .filter(
                  Boolean
                ),
          })
        );

    /*
     * =====================================================
     * STEP 9
     * Load official eBay condition policy.
     * =====================================================
     */
    const filter =
      `categoryIds:{${categoryId}}`;

    const conditionUrl =
      `${EBAY_API_BASE}` +
      `/sell/metadata/v1/marketplace/` +
      `${MARKETPLACE_ID}` +
      `/get_item_condition_policies` +
      `?filter=${encodeURIComponent(
        filter
      )}`;

    const conditionData =
      await getEbayJson(
        conditionUrl,
        accessToken
      );

    const conditionPolicies =
      conditionData
        .itemConditionPolicies ??
      [];

    const conditionPolicy =
      conditionPolicies.find(
        (policy: any) =>
          String(
            policy.categoryId
          ) ===
          String(
            categoryId
          )
      ) ??
      conditionPolicies[0] ??
      null;

    /*
     * =====================================================
     * STEP 10
     * Normalize condition data for the frontend.
     * =====================================================
     */
    let rawConditions =
      conditionPolicy
        ?.itemConditions ??
      [];

    /*
     * New listings in the three eBay trading-card
     * categories must use:
     *
     * 2750 = Graded
     * 4000 = Ungraded
     *
     * Sandbox may return "Used" as well, but ListNexus
     * should not offer that for these card categories.
     */
    if (
      TRADING_CARD_CATEGORY_IDS.has(
        String(categoryId)
      )
    ) {
      rawConditions =
        rawConditions.filter(
          (condition: any) => {
            const id =
              String(
                condition
                  .conditionId
              );

            return (
              id === "2750" ||
              id === "4000"
            );
          }
        );
    }

    const conditionOptions =
      rawConditions.map(
        (condition: any) => {
          const conditionId =
            String(
              condition
                .conditionId ??
                ""
            );

          const descriptors =
            (
              condition
                .conditionDescriptors ??
              []
            ).map(
              (
                descriptor: any
              ) => ({
                descriptorId:
                  String(
                    descriptor
                      .conditionDescriptorId ??
                      ""
                  ),

                name:
                  descriptor
                    .conditionDescriptorName ??
                  "",

                required:
                  descriptor
                    ?.conditionDescriptorConstraint
                    ?.usage ===
                  "REQUIRED",

                mode:
                  descriptor
                    ?.conditionDescriptorConstraint
                    ?.mode ??
                  null,

                values:
                  (
                    descriptor
                      .conditionDescriptorValues ??
                    []
                  )
                    .map(
                      (
                        value: any
                      ) => ({
                        valueId:
                          String(
                            value
                              .valueId ??
                              value
                                .conditionDescriptorValueId ??
                              ""
                          ),

                        valueName:
                          value
                            .valueName ??
                          value
                            .conditionDescriptorValueName ??
                          "",
                      })
                    )
                    .filter(
                      (
                        value: any
                      ) =>
                        value.valueId &&
                        value.valueName
                    ),
              })
            );

          return {
            conditionId,

            conditionDescription:
              condition
                .conditionDescription ??
              "",

            conditionHelpText:
              condition
                .conditionHelpText ??
              "",

            /*
             * This is what createOrReplaceInventoryItem
             * will eventually receive.
             */
            inventoryCondition:
              getInventoryCondition(
                conditionId
              ),

            descriptors,
          };
        }
      );

    /*
     * =====================================================
     * STEP 11
     * Return seller-reviewable preview.
     *
     * STILL NOTHING IS PUBLISHED.
     * =====================================================
     */
    return Response.json({
      success: true,

      message:
        "eBay Sandbox listing preparation completed.",

      published:
        false,

      product: {
        id:
          product.id,

        sku:
          product.sku,

        quantity:
          product.quantity,
      },

      approvedListing: {
        draftId:
          draft.id,

        title:
          draft.generated_title,

        description:
          draft.generated_description,

        category:
          draft.generated_category,

        condition:
          draft.generated_condition,

        attributes:
          draft.generated_attributes,

        price:
          Number(
            draft.suggested_price
          ),
      },

      ebay: {
        marketplaceId:
          MARKETPLACE_ID,

        categoryTreeId,

        /*
         * Category currently selected.
         */
        suggestedCategory:
          selectedCategory,

        /*
         * Categories the seller can choose from.
         */
        categoryAlternatives,

        /*
         * eBay-required item specifics.
         */
        requiredAspects,

        /*
         * Clean seller-selectable condition data.
         */
        conditionOptions,

        /*
         * Keep raw data temporarily for debugging.
         */
        conditionPolicy,
      },
    });
  } catch (error) {
    console.error(
      "eBay preparation error:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to prepare the listing for eBay.",
      },
      {
        status: 500,
      }
    );
  }
}