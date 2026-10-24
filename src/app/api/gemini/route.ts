import { GoogleGenAI, Type } from "@google/genai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

type GeneratedAttribute = {
  name: string;
  value: string;
};

type GeneratedListing = {
  title: string;
  description: string;
  category: string;
  condition: string;
  attributes: GeneratedAttribute[];
  needs_confirmation: string[];
};

export async function POST(request: Request) {
  try {
    /*
     * STEP 1:
     * Make sure the user is logged into ListNexus.
     */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          error: "You must be logged into ListNexus.",
        },
        { status: 401 }
      );
    }

    /*
     * STEP 2:
     * Get the product ID from the request.
     *
     * The frontend will eventually send whichever
     * product the seller wants AI to analyze.
     */
    const body = await request.json();

    const productId = body.productId?.toString();

    if (!productId) {
      return Response.json(
        {
          error: "Missing productId.",
        },
        { status: 400 }
      );
    }

    /*
     * STEP 3:
     * Load the centralized product from Supabase.
     *
     * We make sure it belongs to the currently
     * logged-in ListNexus user.
     */
    const { data: product, error: productError } =
      await supabase
        .from("products")
        .select(
          `
            id,
            title,
            description,
            sku,
            price,
            quantity,
            category
          `
        )
        .eq("id", productId)
        .eq("user_id", user.id)
        .single();

    if (productError || !product) {
      return Response.json(
        {
          error:
            "Product not found or does not belong to this user.",
        },
        { status: 404 }
      );
    }

    /*
     * STEP 4:
     * Load all images belonging to this product.
     */
    const { data: productImages, error: imagesError } =
      await supabase
        .from("product_images")
        .select(
          `
            id,
            image_url,
            sort_order,
            is_primary
          `
        )
        .eq("product_id", product.id)
        .order("sort_order", {
          ascending: true,
        });

    if (imagesError) {
      return Response.json(
        {
          error: "Could not load product images.",
        },
        { status: 500 }
      );
    }

    if (!productImages || productImages.length === 0) {
      return Response.json(
        {
          error:
            "This product needs at least one image before AI can generate a listing.",
        },
        { status: 400 }
      );
    }

    /*
     * STEP 5:
     * Download each image from Supabase Storage.
     *
     * Gemini receives the actual image bytes rather
     * than relying on the public URL itself.
     */
    const imageParts = await Promise.all(
      productImages.map(async (image) => {
        const imageResponse = await fetch(
          image.image_url
        );

        if (!imageResponse.ok) {
          throw new Error(
            `Could not download product image: ${image.image_url}`
          );
        }

        const imageBuffer = Buffer.from(
          await imageResponse.arrayBuffer()
        );

        /*
         * Get the MIME type returned by Supabase.
         *
         * Your current Bulbasaur image is HEIC,
         * which Gemini supports.
         */
        let mimeType =
          imageResponse.headers.get(
            "content-type"
          ) ?? "image/jpeg";

        // Strip things such as "; charset=utf-8".
        mimeType =
          mimeType.split(";")[0].trim();

        return {
          inlineData: {
            data:
              imageBuffer.toString("base64"),

            mimeType,
          },
        };
      })
    );

    /*
     * STEP 6:
     * Build the AI instructions.
     *
     * Notice that the product is the SOURCE DATA.
     * Gemini is creating a listing draft ABOUT
     * the product, not changing the product itself.
     */
    const prompt = `
You are the AI listing assistant for ListNexus.

ListNexus is a centralized marketplace listing system.
Your job is to create a sales listing draft from the seller's product information
and the provided product images.

The resulting listing may later be adapted for marketplaces such as eBay,
Amazon, Etsy, and others.

IMPORTANT RULES:

- Do not invent product information.
- Use only seller-provided information and information clearly visible in the images.
- If an attribute cannot be confidently determined, put it in needs_confirmation.
- Do not claim authenticity unless authenticity has been independently verified.
- A visible logo or brand name does not prove authenticity.
- Do not hide visible wear, damage, discoloration, scratches, bends, dents,
  whitening, stains, or other condition issues.
- Do not guess a trading card grade.
- Do not claim a card is Near Mint, Mint, PSA 10, or another grade unless the
  seller has provided that information or it can be established reliably.
- If only one side of an item is shown, note in needs_confirmation that additional
  images may be required to confirm condition.
- Do not change inventory quantity.
- Do not claim the item has been sold.
- Do not publish anything.
- The seller must review and approve the generated listing before publication.
- Generate attributes appropriate to the specific product type.
- Do not force generic attributes such as brand, size, model, or color when
  they are not appropriate.
- Keep the title concise and useful for marketplace search.
- The seller's existing price is not an AI valuation. Do not claim it represents
  current market value.

CENTRAL LISTNEXUS PRODUCT DATA:

Original title: ${product.title}
Original description: ${product.description ?? "Not provided"}
SKU: ${product.sku}
Current seller price: $${product.price}
Quantity: ${product.quantity}
Current category: ${product.category ?? "Not provided"}

Analyze the centralized product data together with ALL provided product images.

Generate:

1. An improved marketplace-ready title.
2. An accurate marketplace-ready description.
3. A suggested general ListNexus category.
4. A condition description. If condition cannot be confidently established,
   use "Needs confirmation".
5. Relevant product attributes as name/value pairs.
6. Anything the seller should verify before approving the listing.

Remember:
This is a draft. Do not invent missing details.
`;

    /*
     * STEP 7:
     * Ask Gemini to analyze the product and images.
     *
     * Structured output forces the result into a
     * predictable JSON shape that ListNexus can store.
     */
    const response =
      await ai.models.generateContent({
        model: "gemini-3.6-flash",

        contents: [
          {
            text: prompt,
          },

          ...imageParts,
        ],

        config: {
          responseMimeType:
            "application/json",

          responseSchema: {
            type: Type.OBJECT,

            properties: {
              title: {
                type: Type.STRING,
              },

              description: {
                type: Type.STRING,
              },

              category: {
                type: Type.STRING,
              },

              condition: {
                type: Type.STRING,
              },

              attributes: {
                type: Type.ARRAY,

                items: {
                  type: Type.OBJECT,

                  properties: {
                    name: {
                      type: Type.STRING,
                    },

                    value: {
                      type: Type.STRING,
                    },
                  },

                  required: [
                    "name",
                    "value",
                  ],
                },
              },

              needs_confirmation: {
                type: Type.ARRAY,

                items: {
                  type: Type.STRING,
                },
              },
            },

            required: [
              "title",
              "description",
              "category",
              "condition",
              "attributes",
              "needs_confirmation",
            ],
          },
        },
      });

    if (!response.text) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    const listing =
      JSON.parse(
        response.text
      ) as GeneratedListing;

    /*
     * STEP 8:
     * Save the AI-generated listing draft in Supabase.
     *
     * IMPORTANT:
     * We do NOT overwrite the products table.
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

        /*
         * For now the seller-provided product price
         * remains our price.
         *
         * We're not pretending Gemini knows current
         * marketplace value without actual comp data.
         */
        suggested_price:
          product.price,

        needs_confirmation:
          listing.needs_confirmation,

        ai_provider:
          "Google Gemini",

        ai_model:
          "gemini-3.6-flash",

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
            "Gemini generated the listing, but ListNexus could not save the draft.",
        },
        { status: 500 }
      );
    }

    /*
     * STEP 9:
     * Return both the central product identity and
     * the generated listing draft.
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

        price:
          product.price,

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

        price:
          draft.suggested_price,

        status:
          draft.status,
      },
    });
  } catch (error: any) {
    console.error(
      "Gemini listing generation error:",
      error
    );

    if (error?.status === 503) {
      return Response.json(
        {
          error:
            "Gemini is temporarily unavailable due to high demand. Please try again.",
        },
        { status: 503 }
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate listing.",
      },
      { status: 500 }
    );
  }
}