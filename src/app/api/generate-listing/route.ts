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
      brand,
      size,
      priceMin,
      priceMax,
    } = body;

    const prompt = `
You are the AI listing assistant for ListNexus.

Your job is to improve product listing information provided by the seller.

Rules:
- Do not invent product information.
- If information is unknown, say that it requires confirmation.
- Do not change inventory status.
- Do not claim an item has been sold.
- Do not publish or remove listings.
- The seller must review all generated information before publication.

Seller information:

Title: ${title}
Description: ${description}
Brand: ${brand}
Size: ${size}
Seller price range: $${priceMin} - $${priceMax}

Return:
1. An improved title
2. An improved description
3. A suggested category
4. A suggested price range
5. Any information that requires seller confirmation
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
            brand: {
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
            "brand",
            "category",
            "suggested_price_min",
            "suggested_price_max",
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
                error: "Gemini is temporarily unavailable due to high demand. Please try again.",
            },
            { status: 503 }
            );
        }

        return Response.json(
            { error: "Failed to generate listing." },
            { status: 500 }
        );
    }
}