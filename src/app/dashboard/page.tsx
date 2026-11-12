"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";

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
  error?: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  // Counts from the signed-in user's central ListNexus records.
  const [activeListings, setActiveListings] = useState(0);
  const [drafts, setDrafts] = useState(0);
  const [inventoryItems, setInventoryItems] = useState(0);

  // Live, read-only Bonanza inventory panel from Joshua's dashboard.
  const [inventory, setInventory] = useState<BonanzaInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function loadUserAndStats() {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (cancelled) return;
        if (authError || !user) {
          router.replace("/login");
          return;
        }

        setAuthenticated(true);
        setDisplayName(
          user.user_metadata?.display_name ??
            user.user_metadata?.full_name ??
            ""
        );

        const [productCountResult, draftCountResult, productsResult] =
          await Promise.all([
            supabase
              .from("products")
              .select("*", { count: "exact", head: true })
              .eq("user_id", user.id),
            supabase
              .from("listing_drafts")
              .select("*", { count: "exact", head: true })
              .eq("user_id", user.id),
            supabase
              .from("products")
              .select("id")
              .eq("user_id", user.id),
          ]);

        if (cancelled) return;

        if (productCountResult.error) {
          console.error("Could not count inventory items:", productCountResult.error);
        }
        if (draftCountResult.error) {
          console.error("Could not count listing drafts:", draftCountResult.error);
        }
        if (productsResult.error) {
          console.error("Could not load products for active listings:", productsResult.error);
        }

        setInventoryItems(productCountResult.count ?? 0);
        setDrafts(draftCountResult.count ?? 0);

        const productIds = (productsResult.data ?? []).map((product) => product.id);
        if (productIds.length > 0) {
          const { count, error: listingsError } = await supabase
            .from("marketplace_listings")
            .select("*", { count: "exact", head: true })
            .in("product_id", productIds)
            .eq("status", "ACTIVE");

          if (listingsError) {
            console.error("Could not count active listings:", listingsError);
          } else if (!cancelled) {
            setActiveListings(count ?? 0);
          }
        }
      } catch (err) {
        console.error("Could not load dashboard user:", err);
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    }

    void loadUserAndStats();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();

    async function loadInventory() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/bonanza/inventory", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data: BonanzaInventory = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to load Bonanza inventory");
        }
        if (!controller.signal.aborted) setInventory(data);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to connect to Bonanza");
        setInventory(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadInventory();
    return () => controller.abort();
  }, [authenticated, refreshKey]);

  const items = inventory?.items ?? [];
  const overview = [
    { label: "Active listings", value: String(activeListings) },
    { label: "Drafts", value: String(drafts) },
    { label: "Inventory items", value: String(inventoryItems) },
  ];

  if (checkingAuth || !authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="text-xl font-bold text-blue-600" href="/">
            ListNexus
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium">
            <Link className="text-blue-700 dark:text-blue-400" href="/settings">
              Settings
            </Link>
            <AuthNav showDashboard={false} />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8">
          <div className="mb-2 text-3xl font-bold">
            <span className="text-blue-600">Hello {displayName || "User"},</span>
          </div>
          <h1 className="text-3xl font-bold">ListNexus Station</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Keep track of your listings here!
          </p>
        </section>

        <div className="flex flex-col gap-8 lg:flex-row">
          <section className="min-w-0 flex-1 rounded-[14px] border border-[#2e2e2e] bg-[#f5f5f5] p-4 dark:border-gray-700 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4 dark:border-gray-700">
              <div>
                <h2 className="text-xl font-semibold">Bonanza Inventory</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {inventory ? `Booth: ${inventory.booth}` : "Marketplace inventory"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <p className="text-lg text-gray-500 dark:text-gray-400">
                  Loading Bonanza inventory...
                </p>
              </div>
            ) : error ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center">
                <h2 className="text-xl font-semibold text-red-600 dark:text-red-400">
                  Unable to load inventory
                </h2>
                <p className="text-gray-500 dark:text-gray-400">{error}</p>
                <button
                  type="button"
                  onClick={() => setRefreshKey((current) => current + 1)}
                  className="text-blue-600 underline dark:text-blue-400"
                >
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex min-h-[360px] items-center justify-center text-center">
                <div>
                  <h2 className="text-[2.1rem] font-semibold text-black dark:text-gray-100">
                    No Bonanza listings yet
                  </h2>
                  <p className="mt-6 text-[1.15rem] italic text-gray-500 dark:text-gray-400">
                    Start with a product and create your first marketplace listing.
                  </p>
                  <Link
                    className="mt-8 inline-block text-blue-600 underline decoration-blue-600 underline-offset-4 dark:text-blue-400"
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
                    className="rounded-lg border border-gray-300 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <h3 className="text-lg font-semibold">{item.title}</h3>
                    <div className="mt-3 flex flex-wrap gap-5 text-sm text-gray-600 dark:text-gray-300">
                      <p>
                        <strong>Price:</strong>{" "}
                        {item.price != null && Number(item.price) > 0
                          ? `$${Number(item.price).toFixed(2)}`
                          : "Not set"}
                      </p>
                      <p>
                        <strong>Quantity:</strong> {item.quantity ?? "Not available"}
                      </p>
                      <p>
                        <strong>Status:</strong> {item.status ?? "Not available"}
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
                className="rounded-[14px] border border-[#2e2e2e] bg-[#f8f8f8] p-5 dark:border-gray-700 dark:bg-gray-900"
              >
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {item.label}
                </p>
                <p className="mt-2 text-3xl font-semibold">{item.value}</p>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </main>
  );
}
