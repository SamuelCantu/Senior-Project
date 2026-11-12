
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BonanzaItem = {
  id: string | number;
  title: string;
  price?: string | number | null;
  quantity?: string | number | null;
  status?: string | null;
};

type BonanzaInventory = {
  success: boolean;
  marketplace: string;
  booth: string;
  totalListings: number;
  items: BonanzaItem[];
};

export default function DashboardPage() {
  const [inventory, setInventory] =
    useState<BonanzaInventory | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInventory() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          "/api/bonanza/inventory",
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(
            data.error || "Failed to load Bonanza inventory"
          );
        }

        setInventory(data);
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to connect to Bonanza"
        );
        setInventory(null);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadInventory();

    return () => controller.abort();
  }, [refreshKey]);

  const items = inventory?.items ?? [];

  const overview = [
    {
      label: "Bonanza items",
      value: loading || error
        ? "—"
        : String(inventory?.totalListings ?? 0),
    },
    {
      label: "Drafts",
      value: "—",
    },
    {
      label: "Inventory items shown",
      value: loading || error
        ? "—"
        : String(items.length),
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link
            className="text-xl font-bold text-blue-600"
            href="/"
          >
            ListNexus
          </Link>

          <nav className="flex items-center gap-5 text-sm font-medium">
            <Link
              className="text-blue-700"
              href="/dashboard"
            >
              Dashboard
            </Link>

            <Link
              className="text-blue-700"
              href="/dashboard"
            >
              Settings
            </Link>

            <Link
              className="text-gray-600 hover:text-blue-600"
              href="/login"
            >
              Log out
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 text-3xl font-bold">
              <span className="text-blue-600">
                Hello User,
              </span>
            </div>

            <h1 className="text-3xl font-bold">
              ListNexus Station
            </h1>

            <p className="mt-2 text-gray-600">
              Keep track of your listings here!
            </p>
          </div>
        </section>

        <div className="flex flex-col gap-8 lg:flex-row">
          <section className="flex-1 rounded-[14px] border border-[#2e2e2e] bg-[#f5f5f5] p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div>
                <h2 className="text-xl font-semibold">
                  Bonanza Inventory
                </h2>

                <p className="text-sm text-gray-500">
                  {inventory
                    ? `Booth: ${inventory.booth}`
                    : "Marketplace inventory"}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setRefreshKey((current) => current + 1)
                }
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <p className="text-lg text-gray-500">
                  Loading Bonanza inventory...
                </p>
              </div>
            ) : error ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center">
                <h2 className="text-xl font-semibold text-red-600">
                  Unable to load inventory
                </h2>

                <p className="text-gray-500">{error}</p>

                <button
                  type="button"
                  onClick={() =>
                    setRefreshKey((current) => current + 1)
                  }
                  className="text-blue-600 underline"
                >
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex min-h-[360px] items-center justify-center text-center">
                <div>
                  <h2 className="text-[2.1rem] font-semibold text-black">
                    No listings yet
                  </h2>

                  <p className="mt-6 text-[1.15rem] italic text-gray-500">
                    Start with a product and create your first
                    marketplace listing.
                  </p>

                  <Link
                    className="mt-8 inline-block text-blue-600 underline decoration-blue-600 underline-offset-4"
                    href="/ai"
                  >
                    Create your first listing
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-gray-300 bg-white p-5"
                  >
                    <h3 className="text-lg font-semibold">
                      {item.title}
                    </h3>

                    <div className="mt-3 flex flex-wrap gap-5 text-sm text-gray-600">
                      <p>
                        <strong>Price:</strong>{" "}
                        {Number(item.price) > 0
                          ? `$${Number(item.price).toFixed(2)}`
                          : "Not set"}
                      </p>

                      <p>
                        <strong>Quantity:</strong>{" "}
                        {item.quantity ?? "Not available"}
                      </p>

                      <p>
                        <strong>Status:</strong>{" "}
                        {item.status ?? "Not available"}
                      </p>
                    </div>

                    <p className="mt-3 text-xs text-gray-400">
                      Bonanza Item ID: {item.id}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="w-full space-y-5 lg:w-[340px]">
            {overview.map((item) => (
              <div
                key={item.label}
                className="rounded-[14px] border border-[#2e2e2e] bg-[#f8f8f8] p-5"
              >
                <p className="text-sm text-gray-600">
                  {item.label}
                </p>

                <p className="mt-2 text-3xl font-semibold">
                  {item.value}
                </p>
              </div>
            ))}
          </aside>
        </div>

        <div className="mt-8">
          <Link
            href="/ai"
            className="flex h-[72px] items-center justify-center rounded-lg bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700"
          >
            Create a listing
          </Link>
        </div>
      </div>
    </main>
  );
}
