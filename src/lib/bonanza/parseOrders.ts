// Parse both forms Bonanza documents/uses for orderArray and itemArray.
// No network or database operations in this module.
export type BonanzaSale = {
  orderId: string;
  itemId: string;
  quantity: number;
};

type DataObject = Record<string, unknown>;

function objectOf(value: unknown): DataObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as DataObject)
    : null;
}

function entriesOf(value: unknown, member: "order" | "item"): unknown[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  const obj = objectOf(value);
  if (!obj) throw new Error(`Unexpected Bonanza ${member} array shape.`);
  if (member in obj) {
    const nested = obj[member];
    return nested == null ? [] : Array.isArray(nested) ? nested : [nested];
  }
  // A single unwrapped order or item is also supported.
  if (member === "order" && ("orderID" in obj || "orderStatus" in obj)) return [obj];
  if (member === "item" && ("itemID" in obj || "parentItemID" in obj)) return [obj];
  if (Object.keys(obj).length === 0) return [];
  throw new Error(`Unrecognized Bonanza ${member} container.`);
}

function unwrap(value: unknown, member: "order" | "item"): DataObject {
  const obj = objectOf(value);
  const data = obj && member in obj ? objectOf(obj[member]) : obj;
  if (!data) throw new Error(`Unexpected Bonanza ${member} entry.`);
  return data;
}

export function extractBonanzaPaidSales(
  response: unknown,
  itemId: string,
): { sales: BonanzaSale[]; orderCount: number } {
  const payload = objectOf(response);
  if (!payload) throw new Error("Bonanza getOrdersResponse must be an object.");
  const orderEntries = entriesOf(payload.orderArray, "order");
  const sales: BonanzaSale[] = [];

  for (const entry of orderEntries) {
    const order = unwrap(entry, "order");
    const status = order.orderStatus;
    if (typeof status !== "string") {
      throw new Error("Bonanza order status is missing or invalid.");
    }
    if (status !== "Completed" && status !== "Shipped") continue;

    const lines = entriesOf(order.itemArray, "item");
    let quantity = 0;
    for (const entryLine of lines) {
      const line = unwrap(entryLine, "item");
      // parentItemID is the original item on multi-quantity sales.
      const originalId = String(line.parentItemID ?? line.itemID ?? "");
      if (originalId !== itemId) continue;
      const soldQty = Number(line.quantity);
      if (!Number.isSafeInteger(soldQty) || soldQty <= 0) {
        throw new Error("Invalid quantity on a paid Bonanza order.");
      }
      quantity += soldQty;
      if (!Number.isSafeInteger(quantity)) throw new Error("Bonanza quantity overflow.");
    }
    if (quantity === 0) continue;

    const orderId = String(order.orderID ?? "");
    if (!/^\d+$/.test(orderId)) {
      throw new Error("Paid Bonanza order has an invalid ID.");
    }
    sales.push({ orderId, itemId, quantity });
  }
  return { sales, orderCount: orderEntries.length };
}
