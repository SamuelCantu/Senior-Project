import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bonanzaCall, getBoothItem, testConfiguration } from "@/lib/bonanza/server";
import { extractBonanzaPaidSales, type BonanzaSale as Sale } from "@/lib/bonanza/parseOrders";

export const runtime = "nodejs";

async function getCompletedSales(itemId: string, publishedAt: string): Promise<Sale[]> {
  // Include an overlap to catch orders placed while the publish call finished.
  const start = new Date(new Date(publishedAt).getTime() - 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid publication time.");
  const sales: Sale[] = [];
  for (let page = 1; page <= 100; page++) {
    const data = await bonanzaCall("getOrdersRequest", {
      orderRole: "seller",
      soldTimeFrom: start.toISOString(),
      paginationInput: { entriesPerPage: 100, pageNumber: page },
    });
    const result = data.getOrdersResponse;
    if (!result) throw new Error("Bonanza order response is missing.");
    const parsed = extractBonanzaPaidSales(result, itemId);
    sales.push(...parsed.sales);
    const more = result.hasMoreOrders === true || result.hasMoreOrders === "true";
    if (!more && parsed.orderCount < 100) return sales;
    if (!more && page >= Number(result.paginationResult?.totalNumberOfPages ?? 0)) return sales;
  }
  throw new Error("Too many order pages; sync canceled rather than skipping any orders.");
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const { ownerId, itemId, boothId } = testConfiguration();
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return Response.json({ error: "Log in first." }, { status: 401 });
    if (user.id !== ownerId) return Response.json({ error: "Bonanza isn't linked to your user." }, { status: 403 });

    const body = (await request.json()) as Record<string, unknown>;
    const mode = body.mode;
    if (mode !== "preview" && mode !== "apply") {
      return Response.json({ error: "mode must be preview or apply." }, { status: 400 });
    }
    if (mode === "apply" &&
        (process.env.BONANZA_ENABLE_ORDER_SYNC !== "true" || body.confirmation !== "SYNC")) {
      return Response.json({ error: "Order-sync writes are disabled or not confirmed." }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: map, error: mapError } = await admin.from("bonanza_publications")
      .select("id,user_id,product_id,external_item_id,status,published_at")
      .eq("user_id", user.id).eq("marketplace", "bonanza")
      .eq("external_item_id", itemId).maybeSingle();
    
    if (mapError) {
      console.error("=== BONANZA DATABASE ERROR ===");
      console.error("Code:", mapError.code);
      console.error("Message:", mapError.message);
      console.error("Hint:", mapError.hint);

      throw new Error(
        "Could not read marketplace mapping."
      );
    }

    if (!map?.published_at) {
      return Response.json({ success: true, ready: false, message: "No published Bonanza item is linked yet.", pending: [], applied: [] });
    }

    const { data: product } = await admin.from("products")
      .select("id,quantity,sku").eq("id", map.product_id)
      .eq("user_id", user.id).single();
    if (!product) throw new Error("Linked central product does not exist.");

    const paidSales = await getCompletedSales(itemId, map.published_at);
    const uniqueSales = new Map<string, Sale>();
    for (const sale of paidSales) {
      // getOrders normally returns one order per ID; if the API duplicates a
      // record across pages, do not double-count it.
      const prior = uniqueSales.get(sale.orderId);
      if (prior && prior.quantity !== sale.quantity) {
        throw new Error("Conflicting order quantities. Manual review needed.");
      }
      uniqueSales.set(sale.orderId, sale);
    }
    const orders = Array.from(uniqueSales.values());
    const ids = orders.map((o) => o.orderId);
    let processed = new Map<string, { quantity: number; status: string }>();
    if (ids.length) {
      const { data: prior, error: priorError } = await admin.from("bonanza_order_lines")
        .select("order_id,quantity,status")
        .eq("user_id", user.id).eq("item_id", itemId).in("order_id", ids);
      if (priorError) throw new Error("Could not read previously applied orders.");
      processed = new Map((prior ?? []).map((r) => [r.order_id, { quantity: r.quantity, status: r.status }]));
    }
    const unresolved = orders.filter((order) => processed.get(order.orderId)?.status === "oversold");
    if (unresolved.length) {
      return Response.json({
        error: "Previously detected oversold orders require manual seller resolution before syncing again.",
        orderIds: unresolved.map((x) => x.orderId),
      }, { status: 409 });
    }
    const pending = orders.filter((order) => !processed.has(order.orderId));
    const mismatched = orders.filter((order) => {
      const prior = processed.get(order.orderId);
      return prior && prior.quantity !== order.quantity;
    });
    if (mismatched.length) {
      return Response.json({ error: "Previously imported Bonanza order quantities changed. Review manually.", orderIds: mismatched.map(x => x.orderId) }, { status: 409 });
    }

    if (mode === "preview") {
      return Response.json({
        success: true, mode, itemId,
        currentCentralQuantity: product.quantity,
        paidOrdersFound: orders.length,
        alreadyProcessed: orders.length - pending.length,
        pending,
        note: "Read-only preview. Nothing changed in Supabase or Bonanza.",
      });
    }

    // This is intentionally synchronous/manual for the prototype. Each RPC
    // atomically locks a central product and deduplicates its order ID.
    const applied: Array<{ orderId: string; quantity: number; result: string; remaining: number }> = [];
    for (const sale of pending) {
      const { data: decision, error: rpcError } = await admin.rpc("apply_bonanza_sale", {
        p_user_id: user.id,
        p_product_id: product.id,
        p_order_id: sale.orderId,
        p_item_id: itemId,
        p_quantity: sale.quantity,
      });
      if (rpcError || !decision || typeof decision !== "object") {
        throw new Error("Failed to atomically apply a paid Bonanza order. Check sync records before retrying.");
      }
      const result = decision as { result?: string; remaining?: number };
      applied.push({
        orderId: sale.orderId, quantity: sale.quantity,
        result: String(result.result ?? "unknown"),
        remaining: Number(result.remaining),
      });
      if (result.result === "oversold" || result.result === "conflict") break;
    }

    const { data: updated } = await admin.from("products")
      .select("quantity").eq("id", product.id).eq("user_id", user.id).single();
    if (!updated) throw new Error("Central quantity could not be read after sync.");
    const remaining = Number(updated.quantity);
    const issue = applied.some((x) => x.result === "oversold" || x.result === "conflict");

    // Bonanza reduces its own stock when its own orders sell. Never increase
    // its quantity automatically from this polling reconciliation.
    let bonanzaAction = "No outbound quantity change made.";
    if (!issue && process.env.BONANZA_ENABLE_QUANTITY_PUSH === "true") {
      const remote = await getBoothItem(itemId, boothId);
      if (!remote) throw new Error("Cannot verify Bonanza item quantity.");
      const remoteQty = Number(remote.quantity);
      if (!Number.isInteger(remoteQty) || remoteQty < 0) throw new Error("Bonanza returned invalid quantity.");
      if (remoteQty > remaining) {
        const changed = await bonanzaCall("updateInventoryRequest", {
          updates: { [itemId]: { quantity: remaining } },
        });
        const itemResult = changed.updateInventoryResponse?.[itemId];
        if (!(itemResult?.success === true || itemResult?.success === "true")) {
          throw new Error("Bonanza quantity correction wasn't confirmed.");
        }
        bonanzaAction = `Requested Bonanza quantity reduction from ${remoteQty} to ${remaining}.`;
      }
    }

    await admin.from("bonanza_publications")
      .update({ last_sync_at: new Date().toISOString() }).eq("id", map.id);

    return Response.json({
      success: !issue,
      mode, itemId, processed: applied,
      centralQuantity: remaining,
      bonanzaAction,
      warning: issue
        ? "A paid order exceeds available stock. Do not partially fulfill or retry automatically; seller intervention is required."
        : "Manual sync completed. Other marketplaces are NOT yet updated. Polling is not real-time oversell prevention.",
    }, { status: issue ? 409 : 200 });
  } catch (error) {
    console.error("Bonanza order sync error:", error instanceof Error ? error.message : "Unknown");
    return Response.json({
      error: "Sync failed or was only partially applied. Check central inventory and order records before retrying.",
      serverDetail: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
    }, { status: 502 });
  }
}
