import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const title = formData.get("title")?.toString() ?? "";
    const description = formData.get("description")?.toString() ?? "";
    const priceMin = formData.get("priceMin")?.toString() ?? "";
    const priceMax = formData.get("priceMax")?.toString() ?? "";

    const images = formData
      .getAll("images")
      .filter((item): item is File => item instanceof File);

    // Validate required seller information
    if (!title || !description || !priceMin || !priceMax) {
      return Response.json(
        { error: "Missing required listing information." },
        { status: 400 }
      );
    }

    // Keep this consistent with the Gemini route
    if (images.length < 2 || images.length > 5) {
      return Response.json(
        { error: "Please upload between 2 and 5 product images." },
        { status: 400 }
      );
    }

    const prompt = `
You are the AI listing assistant for ListNexus.

Your job is to improve product listing information provided by the seller.

ListNexus may be used to sell many different types of items, including clothing,
electronics, collectibles, artwork, household items, and other products.

Rules:
- Do not invent product information.
- Use seller-provided information and clearly visible information from uploaded images.
- If an image is unclear or an attribute cannot be confidently determined, include it in needs_confirmation instead of guessing.
- Do not assume that a visible logo proves authenticity.
- Do not claim that an item is authentic unless authenticity has been independently verified.
- Do not hide visible damage, wear, discoloration, or other relevant condition information.
- Do not change inventory status.
- Do not claim that an item has been sold.
- Do not publish, remove, or modify marketplace listings.
- Do not override seller-provided information without flagging a possible conflict.
- The seller must review all generated information before publication.
- Keep suggested prices within the seller's provided price range.
- Suggested attributes should be appropriate for the type of item being listed.
- Do not assume that every item has attributes such as brand, size, model, or color.

Seller information:

Title: ${title}
Description: ${description}
Seller price range: $${priceMin} - $${priceMax}

Analyze the seller information together with all uploaded product images.

Generate:
1. An improved title
2. An improved description
3. A suggested category
4. A suggested minimum price
5. A suggested maximum price
6. Relevant item attributes
7. Any information that may require seller confirmation
`;

    // Convert each uploaded image into a data URL OpenAI can analyze
    const imageContent = await Promise.all(
      images.map(async (image) => {
        const imageBuffer = Buffer.from(await image.arrayBuffer());
        const base64Image = imageBuffer.toString("base64");

        return {
          type: "input_image" as const,
          image_url: `data:${image.type};base64,${base64Image}`,
          detail: "auto" as const,
        };
      })
    );

    const response = await openai.responses.create({
      model: "gpt-6-luna",

      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            ...imageContent,
          ],
        },
      ],

      text: {
        format: {
          type: "json_schema",
          name: "listing_result",
          strict: true,

          schema: {
            type: "object",

            properties: {
              title: {
                type: "string",
              },

              description: {
                type: "string",
              },

              category: {
                type: "string",
              },

              suggested_price_min: {
                type: "number",
              },

              suggested_price_max: {
                type: "number",
              },

              attributes: {
                type: "array",
                items: {
                  type: "string",
                },
              },

              needs_confirmation: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },

            required: [
              "title",
              "description",
              "category",
              "suggested_price_min",
              "suggested_price_max",
              "attributes",
              "needs_confirmation",
            ],

            additionalProperties: false,
          },
        },
      },
    });

    if (!response.output_text) {
      throw new Error("OpenAI returned an empty response.");
    }

    const listing = JSON.parse(response.output_text);

    return Response.json(listing);
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error: "Failed to generate listing with OpenAI.",
      },
      { status: 500 }
    );
  }
}