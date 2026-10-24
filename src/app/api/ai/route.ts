import OpenAI from "openai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/*
 * Create the OpenAI client only when the API route runs.
 * This prevents build-time warnings if the key is missing.
 */
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY environment variable."
    );
  }

  return new OpenAI({
    apiKey,
  });
}

/*
 * Wait helper used for automatic retries.
 */
function delay(milliseconds: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}

/*
 * Retry temporary AI errors automatically.
 *
 * This is one thing we wanted to improve after the
 * repeated Gemini 503 errors.
 */
async function withRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  const maxAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      return await operation();
    } catch (error: any) {
      const status = error?.status;

      const retryable =
        status === 408 ||
        status === 409 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;

      /*
       * If this is not a temporary error, or we have
       * already used all retries, stop retrying.
       */
      if (
        !retryable ||
        attempt === maxAttempts
      ) {
        throw error;
      }

      /*
       * Retry delays:
       *
       * Attempt 1 failure -> 1 second
       * Attempt 2 failure -> 2 seconds
       */
      const waitTime =
        1000 * Math.pow(2, attempt - 1);

      console.warn(
        `OpenAI request failed with status ${status}. Retrying in ${waitTime}ms...`
      );

      await delay(waitTime);
    }
  }

  throw new Error(
    "AI generation failed after multiple attempts."
  );
}

type GeneratedAttribute = {
  name: string;
  value: string;
};

type GeneratedListing = {
  title: string;
  description: string;
  category: string;
  condition: string;
  suggested_price: number;
  attributes: GeneratedAttribute[];
  needs_confirmation: string[];
};

export async function POST(request: Request) {
  try {
    /*
     * =====================================================
     * STEP 1
     * Make sure the ListNexus user is logged in.
     * =====================================================
     */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
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
     * Get the product ID from the frontend.
     * =====================================================
     */
    const body = await request.json();

    const productId =
      body.productId?.toString();

    if (!productId) {
      return Response.json(
        {
          error: "Missing productId.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * STEP 3
     * Load the centralized ListNexus product.
     * =====================================================
     */
    const {
      data: product,
      error: productError,
    } = await supabase
      .from("products")
      .select(`
        id,
        title,
        description,
        sku,
        price,
        quantity,
        status,
        category
      `)
      .eq("id", productId)
      .eq("user_id", user.id)
      .single();

    if (
      productError ||
      !product
    ) {
      return Response.json(
        {
          error:
            "Product not found or does not belong to this user.",
        },
        {
          status: 404,
        }
      );
    }

    /*
     * Only AVAILABLE products should get new
     * marketplace listing drafts.
     */
    if (
      product.status !== "AVAILABLE"
    ) {
      return Response.json(
        {
          error:
            "This product is not currently available for listing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * STEP 4
     * Load the product's stored images.
     * =====================================================
     */
    const {
      data: productImages,
      error: imagesError,
    } = await supabase
      .from("product_images")
      .select(`
        id,
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

    if (imagesError) {
      console.error(
        "Product image lookup error:",
        imagesError
      );

      return Response.json(
        {
          error:
            "Could not load product images.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      !productImages ||
      productImages.length === 0
    ) {
      return Response.json(
        {
          error:
            "This product needs at least one image before AI can generate a listing.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * STEP 5
     * Build the AI prompt.
     * =====================================================
     */
    const prompt = `
You are the AI listing assistant for ListNexus.

ListNexus is a centralized multi-marketplace resale listing and inventory system.

Your job is to analyze the seller's centralized product information together with all provided product images and create a marketplace-ready listing draft.

The draft may later be adapted for marketplaces such as eBay, Amazon, Etsy, and others.

IMPORTANT RULES:

- Do not invent product information.
- Use seller-provided information and information clearly visible in the images.
- If something cannot be confidently determined, add it to needs_confirmation.
- Do not claim authenticity unless authenticity has been independently verified.
- A visible logo does not prove authenticity.
- Do not hide visible damage, wear, whitening, scratches, dents, discoloration, stains, bends, or other condition issues.
- Do not claim a trading card grade unless the seller explicitly provided one.
- Do not claim PSA, BGS, CGC, TAG, Near Mint, Mint, or another formal grade unless supported by seller-provided information.
- If important information cannot be seen because only one side of an item is photographed, mention that in needs_confirmation.
- Do not change inventory quantity.
- Do not claim that the product has already been sold.
- Do not publish anything.
- Everything you generate is only a suggestion.
- The seller has final control and may override every generated field.
- Generate attributes appropriate to the product type.
- Do not force irrelevant generic attributes.
- Keep the title useful for marketplace search.
- Do not treat the seller's current price as verified market value.
- You may suggest a different listing price, but do not claim that the suggestion represents current market value unless actual market data was supplied.
- If there is not enough information to justify a different price, use the seller's current price as the suggested price.

CENTRAL LISTNEXUS PRODUCT DATA:

Original title: ${product.title}

Original description:
${product.description ?? "Not provided"}

SKU: ${product.sku}

Seller's current base price:
$${product.price}

Quantity:
${product.quantity}

Current category:
${product.category ?? "Not provided"}

Analyze the centralized product information and ALL attached product images.

Generate:

1. A marketplace-ready title.
2. A marketplace-ready description.
3. A suggested ListNexus category.
4. A condition description.
5. A suggested listing price.
6. Relevant product attributes as name/value pairs.
7. Any information the seller should verify before approving the listing.

Remember that the seller can change every field before approval.
`;

    /*
     * =====================================================
     * STEP 6
     * Build OpenAI input.
     *
     * Because our Supabase Storage bucket is public,
     * OpenAI can receive the JPG URLs directly.
     * =====================================================
     */
    const content: any[] = [
      {
        type: "input_text",
        text: prompt,
      },
    ];

    for (
      const image of productImages
    ) {
      content.push({
        type: "input_image",

        image_url:
          image.image_url,

        /*
         * Use high detail because identifying
         * collectibles/cards can require reading
         * small text and visual details.
         */
        detail: "high",
      });
    }

    /*
     * =====================================================
     * STEP 7
     * Generate the listing with OpenAI.
     * =====================================================
     */
    const openai =
      getOpenAIClient();

    const response =
      await withRetry(() =>
        openai.responses.create({
          model:
            "gpt-5.6-luna",

          reasoning: {
            effort: "low",
          },

          input: [
            {
              role: "user",
              content,
            },
          ],

          /*
           * Structured Outputs forces OpenAI to
           * return data matching this exact schema.
           */
          text: {
            format: {
              type:
                "json_schema",

              name:
                "listnexus_listing_draft",

              strict:
                true,

              schema: {
                type:
                  "object",

                additionalProperties:
                  false,

                properties: {
                  title: {
                    type:
                      "string",
                  },

                  description: {
                    type:
                      "string",
                  },

                  category: {
                    type:
                      "string",
                  },

                  condition: {
                    type:
                      "string",
                  },

                  suggested_price: {
                    type:
                      "number",
                  },

                  attributes: {
                    type:
                      "array",

                    items: {
                      type:
                        "object",

                      additionalProperties:
                        false,

                      properties: {
                        name: {
                          type:
                            "string",
                        },

                        value: {
                          type:
                            "string",
                        },
                      },

                      required: [
                        "name",
                        "value",
                      ],
                    },
                  },

                  needs_confirmation: {
                    type:
                      "array",

                    items: {
                      type:
                        "string",
                    },
                  },
                },

                required: [
                  "title",
                  "description",
                  "category",
                  "condition",
                  "suggested_price",
                  "attributes",
                  "needs_confirmation",
                ],
              },
            },
          },

          max_output_tokens:
            2000,
        })
      );

    /*
     * =====================================================
     * STEP 8
     * Get the structured JSON response.
     * =====================================================
     */
    if (!response.output_text) {
      throw new Error(
        "OpenAI returned an empty response."
      );
    }

    let listing: GeneratedListing;

    try {
      listing =
        JSON.parse(
          response.output_text
        ) as GeneratedListing;
    } catch {
      throw new Error(
        "OpenAI returned an invalid listing response."
      );
    }

    /*
     * Basic sanity check on AI price.
     */
    if (
      !Number.isFinite(
        listing.suggested_price
      ) ||
      listing.suggested_price <= 0
    ) {
      listing.suggested_price =
        Number(product.price);
    }

    /*
     * =====================================================
     * STEP 9
     * Store the AI draft in Supabase.
     *
     * IMPORTANT:
     * This does NOT change the original products row.
     * =====================================================
     */
    const admin =
      createAdminClient();

    const {
      data: draft,
      error: draftError,
    } = await admin
      .from("listing_drafts")
      .insert({
        product_id:
          product.id,

        user_id:
          user.id,

        generated_title:
          listing.title,

        generated_description:
          listing.description,

        generated_category:
          listing.category,

        generated_condition:
          listing.condition,

        generated_attributes:
          listing.attributes,

        suggested_price:
          listing.suggested_price,

        needs_confirmation:
          listing.needs_confirmation,

        ai_provider:
          "OpenAI",

        ai_model:
          "gpt-5.6-luna",

        status:
          "GENERATED",

        updated_at:
          new Date().toISOString(),
      })
      .select()
      .single();

    if (draftError) {
      console.error(
        "Failed to save AI listing draft:",
        draftError
      );

      return Response.json(
        {
          error:
            "AI generated the listing, but ListNexus could not save the draft.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * STEP 10
     * Return the centralized product and AI draft.
     * =====================================================
     */
    return Response.json({
      success: true,

      message:
        "AI listing draft generated successfully.",

      product: {
        id:
          product.id,

        sku:
          product.sku,

        originalTitle:
          product.title,

        basePrice:
          Number(
            product.price
          ),

        quantity:
          product.quantity,
      },

      listing: {
        id:
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

        needsConfirmation:
          draft.needs_confirmation,

        /*
         * This is the AI suggestion.
         * The seller can override it in the UI.
         */
        price:
          Number(
            draft.suggested_price
          ),

        status:
          draft.status,
      },
    });
  } catch (error: any) {
    console.error(
      "OpenAI listing generation error:",
      error
    );

    /*
     * Temporary provider problem.
     */
    if (
      error?.status === 429 ||
      error?.status === 500 ||
      error?.status === 502 ||
      error?.status === 503 ||
      error?.status === 504
    ) {
      return Response.json(
        {
          error:
            "The AI service is temporarily unavailable. ListNexus automatically retried the request, but it still could not complete it. Please try again shortly.",
        },
        {
          status: 503,
        }
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate listing.",
      },
      {
        status: 500,
      }
    );
  }
}