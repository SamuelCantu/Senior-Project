
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  // Temporary development-only endpoint.
  // Production access will require user authentication.
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 }
    );
  }

  const devId = process.env.BONANZA_DEV_ID;
  const certId = process.env.BONANZA_CERT_ID;
  const token = process.env.BONANZA_USER_TOKEN;
  const boothId = process.env.BONANZA_BOOTH_ID;

  if (!devId || !certId || !token || !boothId) {
    return NextResponse.json(
      { error: "Bonanza configuration is incomplete" },
      { status: 500 }
    );
  }

  try {

    const args = {
      boothId,
      requesterCredentials: {
        bonanzleAuthToken: token,
      },
      itemStatus: [
        "for_sale",
        "ready_to_post",
        "missing_fields",
        "reserved",
      ],
      itemsPerPage: 20,
      page: 1,
    };


    const body = new URLSearchParams({
      getBoothItemsRequest: JSON.stringify(args),
    });

    const response = await fetch(
      "https://api.bonanza.com/api_requests/secure_request",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-BONANZLE-API-DEV-NAME": devId,
          "X-BONANZLE-API-CERT-NAME": certId,
        },
        body: body.toString(),
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok || data.ack !== "Success") {
      return NextResponse.json(
        { error: "Bonanza inventory request failed" },
        { status: 502 }
      );
    }

    const inventory = data.getBoothItemsResponse;

    if (!inventory) {
      throw new Error("Missing inventory response");
    }

    const items = Array.isArray(inventory.items)
      ? inventory.items
      : inventory.items
        ? [inventory.items]
        : [];

    return NextResponse.json({
      success: true,
      marketplace: "Bonanza",
      booth: boothId,
      totalListings: inventory.totalEntries ?? items.length,
      items: items.map((item: {
        itemID: string;
        title: string;
        currentPrice: number;
        quantity: number;
        listingStatus: string;
      }) => ({
        id: item.itemID,
        title: item.title,
        price: item.currentPrice,
        quantity: item.quantity,
        status: item.listingStatus,
      })),
    });
  } catch (error) {
    console.error(
      "Bonanza inventory error:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return NextResponse.json(
      { error: "Unable to retrieve inventory" },
      { status: 502 }
    );
  }
}
