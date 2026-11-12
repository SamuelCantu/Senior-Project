import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { testConfiguration } from "@/lib/bonanza/server";
import { extractBonanzaPaidSales } from "@/lib/bonanza/parseOrders";

export const runtime = "nodejs";

// Classroom-only test. It NEVER contacts Bonanza, publishes listings,
// or keeps simulated Supabase changes. The RPC rolls back its inner writes.
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { ownerId, itemId } = testConfiguration();
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: "Log into ListNexus first." }, { status: 401 });
    }
    if (user.id !== ownerId) {
      return Response.json({ error: "Bonanza test account isn't linked to this user." }, { status: 403 });
    }

    const admin = createAdminClient();
    // For this single-product classroom test, SKU 10 identifies the Perler set.
    const { data: product, error: productError } = await admin
      .from("products")
      .select("id,quantity,sku")
      .eq("user_id", user.id)
      .eq("sku", "10")
      .single();
    if (productError || !product) {
      throw new Error("Could not find the owned test product with SKU 10.");
    }

    // Unlikely to collide with any real order ID; the database test also
    // verifies no simulated order IDs already exist before it runs.
    const first = randomBytes(8).readBigUInt64BE().toString();
    const second = randomBytes(8).readBigUInt64BE().toString();
    const third = randomBytes(8).readBigUInt64BE().toString();
    if (new Set([first, second, third]).size !== 3) {
      throw new Error("Test IDs unexpectedly collided; try again.");
    }

    // Feed the EXACT parser used by the real order synchronization route.
    const mockBonanzaResponse = {
      orderArray: [
        { order: {
          orderID: first,
          orderStatus: "Completed",
          itemArray: [{ item: { itemID: 800001, parentItemID: itemId, quantity: 2 } }],
        } },
        { order: {
          orderID: second,
          orderStatus: "Shipped",
          itemArray: [{ item: { itemID: itemId, quantity: 1 } }],
        } },
        { order: {
          orderID: third,
          orderStatus: "Completed",
          itemArray: [{ item: { itemID: itemId, quantity: 999 } }],
        } },
        { order: {
          orderID: "9000004",
          orderStatus: "InProcess",
          itemArray: [{ item: { itemID: itemId, quantity: 100 } }],
        } },
        { order: {
          orderID: "9000005",
          orderStatus: "Completed",
          itemArray: [{ item: { itemID: "999999999", quantity: 500 } }],
        } },
      ],
    };

    const parsed = extractBonanzaPaidSales(mockBonanzaResponse, itemId);
    if (parsed.orderCount !== 5 || parsed.sales.length !== 3 ||
        parsed.sales[0]?.quantity !== 2 ||
        parsed.sales[1]?.quantity !== 1 ||
        parsed.sales[2]?.quantity !== 999) {
      throw new Error("Bonanza parser failed the five-order mock test.");
    }

    // Only the server's service-role client may execute this function.
    // The function runs the REAL atomic inventory RPC in a subtransaction,
    // intentionally rolls it back, and verifies no changes persisted.
    const { data, error: rpcError } = await admin.rpc("dry_run_bonanza_sales", {
      p_user_id: user.id,
      p_product_id: product.id,
      p_item_id: itemId,
      p_sales: parsed.sales,
    });
    if (rpcError) {
      console.error("Bonanza dry-run RPC:", rpcError.code, rpcError.message);
      throw new Error("Database simulation failed. Check the VS Code terminal.");
    }
    if (!data || data.passed !== true || data.permanentChanges !== false ||
        data.testOrderRecordsRemaining !== 0) {
      throw new Error("Database did not confirm a safe rollback.");
    }

    return Response.json({
      success: true,
      message: "Bonanza parser and atomic inventory function passed together.",
      parser: {
        exampleOrders: parsed.orderCount,
        paidOrdersForOurItem: parsed.sales.length,
        unpaidAndUnrelatedIgnored: 2,
      },
      database: data,
      bonanzaApiContacted: false,
      permanentDatabaseChanges: false,
    });
  } catch (error) {
    console.error("Bonanza end-to-end simulation:", error instanceof Error ? error.message : error);
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : "Simulation failed" },
      { status: 500 },
    );
  }
}
