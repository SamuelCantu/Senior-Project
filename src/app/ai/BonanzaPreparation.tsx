"use client";

import { useState } from "react";

type PreviewResponse = {
  success: true;
  bonanza: {
    itemId: string;
    currentStatus: string;
    currentQuantity: number;
    categoryId: number;
  };
  preview: {
    title: string;
    sku: string;
    proposedPrice: number;
    centralQuantity: number;
    images: string[];
  };
};

type UpdateResponse = {
  success: true;
  updated: true;
  published: false;
  itemId: string;
  status: string;
  quantity: number;
  title: string;
  price: number;
  imagesSubmitted: number;
  message: string;
};

export default function BonanzaPreparation({ draftId }: { draftId: string }) {
  const [preparing, setPreparing] = useState(false);
  const [revising, setRevising] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [updated, setUpdated] = useState<UpdateResponse | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function handlePrepare() {
    setPreparing(true);
    setError("");
    setUpdated(null);
    setData(null);
    setAcknowledged(false);
    try {
      const response = await fetch("/api/bonanza/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Could not prepare Bonanza item.");
      }
      setData(result as PreviewResponse);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setPreparing(false);
    }
  }

  async function handleRevise() {
    if (!data || !acknowledged || preparing || revising) return;
    if (
      !window.confirm(
        `Update EXISTING Bonanza item ${data.bonanza.itemId}?\n\n` +
        `Title: ${data.preview.title}\n` +
        `Approved price: $${data.preview.proposedPrice.toFixed(2)}\n` +
        `Bonanza quantity: 0 (not the ${data.preview.centralQuantity} sets in ListNexus)\n\n` +
        "This makes a real API change, but does not publish the item."
      )
    ) return;

    setRevising(true);
    setError("");
    setUpdated(null);
    try {
      const response = await fetch("/api/bonanza/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          expectedItemId: data.bonanza.itemId,
          confirmInactiveUpdate: true,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to update inactive Bonanza item.");
      }
      setUpdated(result as UpdateResponse);
      setAcknowledged(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unexpected error");
      // Never auto-retry a marketplace write: it may have applied on Bonanza.
    } finally {
      setRevising(false);
    }
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-gray-900">
      <h3 className="font-semibold text-blue-900">Verify Existing Bonanza Item</h3>
      <p className="mt-2 text-sm text-blue-800">
        First verify the approved AI draft against your inactive Bonanza item.
        The preparation check is read-only.
      </p>
      <button
        type="button"
        disabled={preparing || revising}
        onClick={handlePrepare}
        className="mt-3 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {preparing ? "Checking Bonanza..." : "Prepare Bonanza (Read Only)"}
      </button>

      {data && (
        <div className="mt-4 space-y-3 rounded-lg border border-green-200 bg-white p-3 text-sm">
          <p className="font-semibold text-green-800">Verified — no changes made by preparation</p>
          <p>Item ID: {data.bonanza.itemId}</p>
          <p>Bonanza status: {data.bonanza.currentStatus}</p>
          <p>Approved title: {data.preview.title}</p>
          <p>Approved price: ${Number(data.preview.proposedPrice).toFixed(2)}</p>
          <p>ListNexus quantity: {data.preview.centralQuantity}</p>
          <p>Bonanza test quantity: {data.bonanza.currentQuantity}</p>
          <p>Photos to submit: {data.preview.images.length}</p>
          <div className="border-t border-gray-200 pt-3">
            <p className="font-semibold text-gray-900">Update the same inactive item</p>
            <p className="mt-1 text-gray-700">
              This next action WILL modify the real Bonanza record. It will send the
              approved title, description, $100-style listing price, category,
              supported traits and product photos. It will keep quantity at zero
              and automatic sale activation disabled.
            </p>
            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={revising || Boolean(updated)}
                className="mt-1"
              />
              <span>
                I understand this updates the real Bonanza item, but will NOT
                publish it or copy the 20 available sets to Bonanza.
              </span>
            </label>
            <button
              type="button"
              onClick={handleRevise}
              disabled={!acknowledged || preparing || revising || Boolean(updated)}
              className="mt-3 rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {revising ? "Updating and verifying..." : "Update Inactive Bonanza Item"}
            </button>
          </div>
        </div>
      )}

      {updated && (
        <div className="mt-4 space-y-1 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          <p className="font-semibold">Bonanza item revised and verified inactive!</p>
          <p>Item ID: {updated.itemId}</p>
          <p>Title: {updated.title}</p>
          <p>Price: ${Number(updated.price).toFixed(2)}</p>
          <p>Bonanza quantity: {updated.quantity}</p>
          <p>Status: {updated.status}</p>
          <p>Image URLs submitted: {updated.imagesSubmitted}</p>
          <p className="mt-2">Refresh the dashboard to see the updated item.</p>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
    </section>
  );
}