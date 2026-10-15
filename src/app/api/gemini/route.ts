import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
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

      // Validate required text fields
      if (!title || !description || !priceMin || !priceMax) {
        return Response.json(
          { error: "Missing required listing information." },
          { status: 400 }
        );
      }

      // Validate number of uploaded images
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
- Use seller-provided information and clearly visible information from the uploaded images.
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
6. Relevant item attributes visible in or supported by the images and seller information
7. Any information that requires seller confirmation
`;
    
    // Convert uploaded images into base64 data that Gemini can analyze
    const imageParts = await Promise.all(
      images.map(async (image) => {
        const imageBuffer = Buffer.from(await image.arrayBuffer());

        return {
          inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: image.type,
          },
        };
      })
    );

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: [ 
        {text: prompt }, 
        ...imageParts, 
      ],
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