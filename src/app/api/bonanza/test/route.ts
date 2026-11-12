
import { NextResponse } from "next/server";

export async function GET() {
  // Only allow this test route during local development.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 }
    );
  }

  const devId = process.env.BONANZA_DEV_ID;

  if (!devId) {
    return NextResponse.json(
      { error: "Missing Bonanza Developer ID" },
      { status: 500 }
    );
  }

  try {
    // Search public Bonanza listings without changing anything.
    const response = await fetch(
      "https://api.bonanza.com/api_requests/standard_request",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-BONANZLE-API-DEV-NAME": devId,
        },
        body: JSON.stringify({
          findItemsByKeywords: {
            keywords: "Pokemon cards",
            paginationInput: {
              entriesPerPage: 3,
            },
          },
        }),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok || data.ack !== "Success") {
      return NextResponse.json(
        {
          success: false,
          message: "Bonanza API request failed",
          status: response.status,
          details: data.errorMessage ?? null,
        },
        { status: 502 }
      );
    }

    const items = data.findItemsByKeywordsResponse?.item ?? [];

    return NextResponse.json({
      success: true,
      message: "Connected to Bonanza successfully!",
      items: items.map(
        (item: {
          itemId: number;
          title: string;
          viewItemURL: string;
        }) => ({
          id: item.itemId,
          title: item.title,
          url: item.viewItemURL,
        })
      ),
    });
  } catch (error) {
    console.error("Bonanza test request failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to communicate with Bonanza",
      },
      { status: 502 }
    );
  }
}
