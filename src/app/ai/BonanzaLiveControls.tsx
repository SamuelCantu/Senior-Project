"use client";

import { useState } from "react";

type PrepareData = {
  success: boolean;
  bonanza: { itemId: string; currentStatus: string; currentQuantity: number };
  preview: { title: string; proposedPrice: number; centralQuantity: number; images: string[] };
};

type SyncPreview = {
  success: boolean;
  ready?: boolean;
  message?: string;
  paidOrdersFound?: number;
  alreadyProcessed?: number;
  currentCentralQuantity?: number;
  pending?: { orderId: string; itemId: string; quantity: number }[];
};

export default function BonanzaLiveControls({ draftId }: { draftId: string }) {
  const [preview, setPreview] = useState<PrepareData | null>(null);
  const [shippingType, setShippingType] = useState<"Calculated" | "Fixed" | "Free">("Calculated");
  const [pounds, setPounds] = useState("");
  const [ounces, setOunces] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [handlingDays, setHandlingDays] = useState("3");
  const [confirmation, setConfirmation] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [publishedMessage, setPublishedMessage] = useState("");
  const [error, setError] = useState("");
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState("");
  const [syncConfirmed, setSyncConfirmed] = useState(false);

  async function loadPreflight() {
    setChecking(true);
    setError("");
    setPreview(null);
    setPublishedMessage("");
    setConfirmation("");
    try {
      const response = await fetch("/api/bonanza/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Bonanza preparation failed.");
      setPreview(data as PrepareData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preparation failed.");
    } finally {
      setChecking(false);
    }
  }

  async function publish() {
    if (!preview || confirmation !== "PUBLISH") return;
    if (!window.confirm(
      `REAL BONANZA SALE LISTING\n\n${preview.preview.title}\n` +
      `Price: $${preview.preview.proposedPrice.toFixed(2)}\n` +
      `Quantity: ${preview.preview.centralQuantity}\n` +
      `Item ID: ${preview.bonanza.itemId}\n\n` +
      "This action can make the product immediately purchasable. Continue?"
    )) return;
    setPublishing(true);
    setError("");
    try {
      const response = await fetch("/api/bonanza/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId, confirmation: "PUBLISH", expectedItemId: preview.bonanza.itemId,
          expectedPrice: preview.preview.proposedPrice,
          expectedQuantity: preview.preview.centralQuantity,
          shipping: {
            type: shippingType, shippingCost,
            pounds, ounces, shipsWithinDays: handlingDays,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Publish wasn't confirmed.");
      setPublishedMessage(data.message + ` Status: ${data.status}. Item: ${data.itemId}.`);
      setPreview(null);
      setConfirmation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish status uncertain. Check the live booth.");
    } finally {
      setPublishing(false);
    }
  }

  async function sync(mode: "preview" | "apply") {
    if (mode === "apply" && !syncConfirmed) return;
    if (mode === "apply" && !window.confirm("Apply paid Bonanza orders to centralized inventory? This will deduct stock from Supabase.")) return;
    setSyncing(true);
    setSyncResult("");
    setError("");
    try {
      const response = await fetch("/api/bonanza/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirmation: mode === "apply" ? "SYNC" : undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.warning || "Order sync failed.");
      if (mode === "preview") {
        setSyncPreview(data as SyncPreview);
      } else {
        setSyncResult(`Sync complete. Central quantity: ${data.centralQuantity}. ${data.bonanzaAction} ${data.warning ?? ""}`);
        setSyncPreview(null);
        setSyncConfirmed(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="space-y-5 rounded-lg border border-amber-300 bg-white p-5 text-gray-900">
      <div>
        <h3 className="text-xl font-bold">Bonanza Live Publishing & Order Sync</h3>
        <p className="mt-2 text-sm text-red-700">
          Real marketplace actions: publishing can accept actual buyer orders. Order sync is currently manual, not real-time.
        </p>
      </div>
      <div className="space-y-3 border-t pt-4">
        <h4 className="font-semibold">1. Preflight the approved listing</h4>
        <button type="button" onClick={loadPreflight} disabled={checking || publishing}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {checking ? "Checking..." : "Check listing before live publishing"}
        </button>
        {preview && (
          <div className="space-y-1 rounded-lg bg-blue-50 p-3 text-sm">
            <p>Item ID: {preview.bonanza.itemId}</p>
            <p>Current Bonanza status: {preview.bonanza.currentStatus}</p>
            <p>Approved title: {preview.preview.title}</p>
            <p>Approved price: ${Number(preview.preview.proposedPrice).toFixed(2)}</p>
            <p>Central quantity to publish: {preview.preview.centralQuantity}</p>
            <p>Images: {preview.preview.images.length}</p>
          </div>
        )}
      </div>
      {preview && (
        <div className="space-y-4 border-t pt-4">
          <h4 className="font-semibold">2. Choose actual shipping terms</h4>
          <label className="block text-sm">Shipping method
            <select className="mt-1 w-full rounded-lg border p-2" value={shippingType}
              onChange={(e) => setShippingType(e.target.value as "Calculated" | "Fixed" | "Free")}>
              <option value="Calculated">USPS calculated shipping</option>
              <option value="Fixed">Flat shipping charge</option>
              <option value="Free">Free shipping (seller pays)</option>
            </select>
          </label>
          {shippingType === "Calculated" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Packaged pounds<input type="number" min="0" step="1"
                className="mt-1 w-full rounded-lg border p-2" value={pounds}
                onChange={(e) => setPounds(e.target.value)} placeholder="Enter actual lbs" /></label>
              <label className="text-sm">Additional ounces<input type="number" min="0" max="15" step="1"
                className="mt-1 w-full rounded-lg border p-2" value={ounces}
                onChange={(e) => setOunces(e.target.value)} placeholder="Enter actual oz" /></label>
              <p className="col-span-2 text-xs text-gray-600">We use USPS and a normal package. Weigh the fully packed item; do not guess.</p>
            </div>
          )}
          {shippingType === "Fixed" && (
            <label className="block text-sm">Shipping cost in USD<input type="number" min="0.01" step="0.01"
              value={shippingCost} onChange={(e) => setShippingCost(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2" placeholder="Enter actual flat shipping price" /></label>
          )}
          <label className="block text-sm">Handling time (business days)<input type="number" min="1" max="30"
            value={handlingDays} onChange={(e) => setHandlingDays(e.target.value)}
            className="mt-1 w-full rounded-lg border p-2" /></label>
          <label className="block text-sm font-semibold">Type PUBLISH to confirm real sales eligibility
            <input className="mt-1 w-full rounded-lg border p-2" value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
          </label>
          <button type="button" disabled={confirmation !== "PUBLISH" || publishing}
            onClick={publish} className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {publishing ? "Contacting live Bonanza..." : "Publish this real Bonanza item"}
          </button>
        </div>
      )}
      {publishedMessage && <p className="rounded-lg bg-green-50 p-3 text-green-800">{publishedMessage}</p>}
      <div className="space-y-3 border-t pt-4">
        <h4 className="font-semibold">3. Reconcile paid Bonanza orders</h4>
        <p className="text-sm text-gray-600">Preview is read-only. Apply deducts paid sales once using database transaction checks.</p>
        <button type="button" onClick={() => sync("preview")} disabled={syncing}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
          {syncing ? "Checking..." : "Check Bonanza orders (Read Only)"}
        </button>
        {syncPreview && (
          <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm">
            {syncPreview.ready === false ? (
              <p>{syncPreview.message}</p>
            ) : (
              <>
                <p>Paid orders found: {syncPreview.paidOrdersFound ?? 0}</p>
                <p>Already processed: {syncPreview.alreadyProcessed ?? 0}</p>
                <p>New orders to apply: {syncPreview.pending?.length ?? 0}</p>
                <p>Current central quantity: {syncPreview.currentCentralQuantity ?? "—"}</p>
              </>
            )}
          </div>
        )}
        {syncPreview?.ready !== false && syncPreview && (
          <div className="space-y-3">
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={syncConfirmed}
              onChange={(e) => setSyncConfirmed(e.target.checked)} /> I reviewed the paid-order count and authorize inventory deductions.</label>
            <button type="button" disabled={!syncConfirmed || syncing}
              onClick={() => sync("apply")}
              className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white disabled:opacity-50">
              Apply paid orders to Supabase
            </button>
          </div>
        )}
        {syncResult && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{syncResult}</p>}
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
