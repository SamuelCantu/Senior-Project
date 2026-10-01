import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      priceMin,
      priceMax,
    } = body;

    const prompt = `
You are the AI listing assistant for ListNexus.

Your job is to improve product listing information provided by the seller.

ListNexus may be used to sell many different types of items, including clothing,
electronics, collectibles, artwork, household items, and other products.

Rules:
- Do not invent product information.
- Use only information provided by the seller or information that can reasonably
  be inferred from the description.
- If information is unknown or uncertain, include it in needs_confirmation.
- Do not claim that an item is authentic unless that information has been verified.
- Do not change inventory status.
- Do not claim that an item has been sold.
- Do not publish, remove, or modify marketplace listings.
- Do not override seller-provided information.
- The seller must review all generated information before publication.
- Keep suggested prices within the seller's provided price range.
- Suggested attributes should be appropriate for the type of item being listed.
- Do not assume that every item has attributes such as brand, size, model, or color.

Seller information:

Title: ${title}
Description: ${description}
Seller price range: $${priceMin} - $${priceMax}

Generate:
1. An improved title
2. An improved description
3. A suggested category
4. A suggested minimum price
5. A suggested maximum price
6. Relevant item attributes
7. Any information that requires seller confirmation
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
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

            suggested_price_min: {
              type: Type.NUMBER,
            },

            suggested_price_max: {
              type: Type.NUMBER,
            },

            attributes: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
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
            "suggested_price_min",
            "suggested_price_max",
            "attributes",
            "needs_confirmation",
          ],
        },
      },
    });

    const listing = JSON.parse(response.text || "{}");

    return Response.json(listing);
  } catch (error: any) {
    console.error(error);

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
        error: "Failed to generate listing.",
      },
      { status: 500 }
    );
  }
}