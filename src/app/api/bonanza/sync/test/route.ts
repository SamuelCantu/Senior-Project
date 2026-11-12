import { createClient } from "@/lib/supabase/server";
import { bonanzaCall, testConfiguration } from "@/lib/bonanza/server";
import { extractBonanzaPaidSales } from "@/lib/bonanza/parseOrders";

export const runtime = "nodejs";

// This route NEVER writes to Supabase or Bonanza.
// It can be used before a listing has been published or mapped.
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { ownerId, itemId } = testConfiguration();
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return Response.json({ error: "Please log into ListNexus first." }, { status: 401 });
    }
    if (user.id !== ownerId) {
      return Response.json({ error: "Bonanza test seller is not linked to this user." }, { status: 403 });
    }

    // Use a shape that matches Bonanza's documented Python API example.
    const example = {
      orderArray: [
        { order: {
          orderID: 900001, orderStatus: "Completed",
          itemArray: [{ item: { itemID: 700001, parentItemID: Number(itemId), quantity: 2 } }],
        } },
        { order: {
          orderID: 900002, orderStatus: "Shipped",
          itemArray: [{ item: { itemID: Number(itemId), quantity: 1 } }],
        } },
        { order: {
          orderID: 900003, orderStatus: "InProcess",
          itemArray: [{ item: { itemID: Number(itemId), quantity: 999 } }],
        } },
        { order: {
          orderID: 900004, orderStatus: "Completed",
          itemArray: [{ item: { itemID: 7777777, quantity: 500 } }],
        } },
      ],
    };
    const mock = extractBonanzaPaidSales(example, itemId);
    const expected = mock.sales.length === 2 &&
      mock.sales[0]?.quantity === 2 &&
      mock.sales[1]?.quantity === 1 &&
      mock.orderCount === 4;
    if (!expected) throw new Error("Mock order parser assertions failed.");

    // Live API READ ONLY: no published mapping or actual sale required.
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const data = await bonanzaCall("getOrdersRequest", {
      orderRole: "seller",
      soldTimeFrom: from.toISOString(),
      paginationInput: { entriesPerPage: 100, pageNumber: 1 },
    });
    if (!data.getOrdersResponse) {
      throw new Error("Bonanza didn't return getOrdersResponse.");
    }
    const live = extractBonanzaPaidSales(data.getOrdersResponse, itemId);
    const hasMore = data.getOrdersResponse.hasMoreOrders;

    return Response.json({
      success: true,
      message: "Mock parser passed and Bonanza order API responded.",
      testItemId: itemId,
      mock: {
        totalOrders: mock.orderCount,
        matchingPaidOrders: mock.sales.length,
        paidUnits: mock.sales.reduce((sum, sale) => sum + sale.quantity, 0),
        unpaidAndOtherItemsIgnored: true,
      },
      bonanza: {
        queriedLastDays: 30,
        ordersOnFirstPage: live.orderCount,
        paidOrdersForTestItem: live.sales.length,
        morePagesExist: hasMore === true || hasMore === "true",
      },
      databaseChanges: false,
      marketplaceChanges: false,
      note: "This tests parsing and API access only. It does not test database order deductions or prove all pages of orders can be retrieved.",
    });
  } catch (err) {
    console.error("Bonanza read-only order test:", err instanceof Error ? err.message : "Unknown error");
    return Response.json({ error: "Bonanza order test failed. Check the VS Code terminal." }, { status: 502 });
  }
}
