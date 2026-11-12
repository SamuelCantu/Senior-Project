"use client";

import { useState } from "react";

type Draft = {
  title: string;
  description: string;
  category: string;
  condition: string;
  price: number;
  status: string;
  attributes: { name: string; value: string }[];
};

type Product = {
  sku: string;
  quantity: number;
};

type ProductImage = {
  id: string;
  image_url: string;
};

type BonanzaPreviewProps = {
  draft: Draft;
  product?: Product;
  images: ProductImage[];
};

export default function BonanzaPreview({
  draft,
  product,
  images,
}: BonanzaPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);

  // These checks are ListNexus pre-publish checks, not a claim that
  // every condition is required by Bonanza's API to save an item.
  const checks = [
    {
      label: "Seller-reviewed draft is approved",
      ok: draft.status === "APPROVED",
    },
    {
      label: "Title is 1–80 characters",
      ok: draft.title.trim().length > 0 && draft.title.trim().length <= 80,
    },
    {
      label: "Description is provided",
      ok: draft.description.trim().length > 0,
    },
    {
      label: "Price is greater than $0",
      ok: Number.isFinite(draft.price) && draft.price > 0,
    },
    {
      label: "Centralized quantity is greater than zero",
      ok: product !== undefined && Number.isInteger(product.quantity) && product.quantity > 0,
    },
    {
      label: "At least one product photo is available",
      ok: images.some((image) => image.image_url.trim().length > 0),
    },
  ];

  const photos = images
    .filter((image) => image.image_url.trim().length > 0)
    .slice(0, 4);

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-blue-900">
            Bonanza Listing Preview
          </h3>
          <p className="mt-1 text-sm text-blue-800">
            Inspect the approved listing before we implement Bonanza publishing.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {isOpen ? "Hide Bonanza Preview" : "Preview for Bonanza"}
        </button>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-4 rounded-lg border bg-white p-4 text-gray-900">
          <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-900">
            Safe preview only. This button does not contact Bonanza, create an item,
            change inventory, or publish a listing.
          </p>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Listing title
            </p>
            <p className="mt-1 text-lg font-semibold">{draft.title || "Untitled"}</p>
            <p className="mt-1 text-xs text-gray-500">
              {draft.title.trim().length}/80 characters
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-gray-500">Price</p>
              <p className="font-medium">
                {Number.isFinite(draft.price)
                  ? `$${draft.price.toFixed(2)}`
                  : "Not available"}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">Central quantity</p>
              <p className="font-medium">{product?.quantity ?? "Not available"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">SKU</p>
              <p className="break-all font-medium">{product?.sku || "Not available"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">
                Proposed category (not yet Bonanza-mapped)
              </p>
              <p className="font-medium">{draft.category || "Not available"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">Condition</p>
              <p className="font-medium">{draft.condition || "Not available"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500">Product images</p>
              <p className="font-medium">
                {photos.length} previewed (Bonanza supports up to four image URLs)
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">
              {draft.description || "Not available"}
            </p>
          </div>

          {draft.attributes.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">Product attributes</h4>
              <dl className="mt-2 space-y-1 text-sm">
                {draft.attributes.map((attribute, index) => (
                  <div key={`${attribute.name}-${index}`} className="flex gap-2">
                    <dt className="min-w-24 font-medium">{attribute.name}:</dt>
                    <dd className="break-words">{attribute.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {photos.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">First four stored images</h4>
              <div className="grid grid-cols-2 gap-3">
                {photos.map((image, index) => (
                  <div key={image.id} className="overflow-hidden rounded-md border bg-gray-50 p-2">
                    {/* The source page already uses ordinary img elements for stored photos. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.image_url}
                      alt={`Bonanza preview photo ${index + 1}`}
                      className="h-28 w-full object-contain"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold">ListNexus pre-publish checks</h4>
            <ul className="mt-2 space-y-1 text-sm">
              {checks.map((check) => (
                <li key={check.label} className={check.ok ? "text-green-800" : "text-amber-800"}>
                  <span aria-hidden="true">{check.ok ? "✓" : "!"}</span>{" "}
                  {check.label}
                </li>
              ))}
            </ul>
          </div>

          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Before live publishing, ListNexus still needs a Bonanza category ID,
            shipping and return settings, verification that image URLs are publicly
            reachable, and a protected server-side publishing endpoint. Your
            proposed category is not automatically a Bonanza category ID.
          </p>
        </div>
      )}
    </section>
  );
}
