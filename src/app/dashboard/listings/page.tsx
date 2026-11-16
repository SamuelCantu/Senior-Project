"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";

type MarketplaceListing = {
  id: string;
  product_id: string;
  marketplace: string;
  external_listing_id: string | null;
  listing_url: string | null;
  price: number | string | null;
  quantity: number;
  status: string;
  enviroment: string | null;

  productTitle: string;
};

export default function ActiveListingsPage() {
  const router = useRouter();

  const [listings, setListings] =
    useState<MarketplaceListing[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const supabase = createClient();

    async function loadListings() {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      /*
       * Get this user's products first.
       * This matches the same ownership logic
       * currently used by the dashboard.
       */
      const {
        data: products,
        error: productsError,
      } = await supabase
        .from("products")
        .select("id, title")
        .eq("user_id", user.id);

      if (productsError) {
        console.error(productsError);

        setError(
          "Could not load your ListNexus products."
        );

        setLoading(false);
        return;
      }

      const productIds =
        (products ?? []).map(
          (product) => product.id
        );

      if (productIds.length === 0) {
        setListings([]);
        setLoading(false);
        return;
      }

      /*
       * Load marketplace listings belonging
       * to those products.
       */
      const {
        data: marketplaceListings,
        error: listingsError,
      } = await supabase
        .from("marketplace_listings")
        .select(`
          id,
          product_id,
          marketplace,
          external_listing_id,
          listing_url,
          price,
          quantity,
          status,
          enviroment
        `)
        .in("product_id", productIds)
        .order("created_at", {
          ascending: false,
        });

      if (listingsError) {
        console.error(listingsError);

        setError(
          "Could not load your marketplace listings."
        );

        setLoading(false);
        return;
      }

      /*
       * Attach the central product title
       * to each marketplace listing.
       */
      const productTitleMap =
        new Map(
          (products ?? []).map(
            (product) => [
              product.id,
              product.title,
            ]
          )
        );

      const preparedListings =
        (marketplaceListings ?? []).map(
          (listing) => ({
            ...listing,

            productTitle:
              productTitleMap.get(
                listing.product_id
              ) ?? "Unknown product",
          })
        );

      setListings(
        preparedListings as MarketplaceListing[]
      );

      setLoading(false);
    }

    loadListings();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">
          Loading listings...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="text-xl font-bold text-blue-600"
          >
            ListNexus
          </Link>

          <nav className="flex items-center gap-5 text-sm font-medium">
            <Link
              href="/dashboard"
              className="hover:text-blue-600"
            >
              Dashboard
            </Link>

            <AuthNav showDashboard={false} />
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <p className="mb-2 font-semibold text-blue-600">
            Marketplace Listings
          </p>

          <h1 className="text-3xl font-bold">
            Active Listings
          </h1>

          <p className="mt-2 text-gray-600 dark:text-gray-400">
            View the marketplace listings connected
            to your ListNexus inventory.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {listings.length === 0 ? (
          <div className="rounded-xl border bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <h2 className="text-xl font-semibold">
              No marketplace listings yet
            </h2>

            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Publish a listing from ListNexus and it
              will appear here.
            </p>

            <Link
              href="/ai"
              className="mt-5 inline-block font-semibold text-blue-600 hover:underline"
            >
              Go to AI Listing →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <table className="w-full text-left">
              <thead className="border-b bg-gray-50 text-sm dark:border-gray-700 dark:bg-gray-800">
                <tr>
                  <th className="px-5 py-4">
                    Item
                  </th>

                  <th className="px-5 py-4">
                    Marketplace
                  </th>

                  <th className="px-5 py-4">
                    Price
                  </th>

                  <th className="px-5 py-4">
                    Quantity
                  </th>

                  <th className="px-5 py-4">
                    Visible
                  </th>

                  <th className="px-5 py-4">
                    Listing
                  </th>
                </tr>
              </thead>

              <tbody>
                {listings.map((listing) => {
                  const visible =
                    listing.status === "ACTIVE" &&
                    listing.enviroment === "PRODUCTION";

                  return (
                    <tr
                      key={listing.id}
                      className="border-b last:border-b-0 dark:border-gray-700"
                    >
                      <td className="px-5 py-4 font-medium">
                        {listing.productTitle}
                      </td>

                      <td className="px-5 py-4">
                        {listing.marketplace}
                      </td>

                      <td className="px-5 py-4">
                        {listing.price !== null
                          ? `$${Number(
                              listing.price
                            ).toFixed(2)}`
                          : "—"}
                      </td>

                      <td className="px-5 py-4">
                        {listing.quantity}
                      </td>

                      <td className="px-5 py-4">
                        {visible ? (
                          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">
                            Yes
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-200 px-3 py-1 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                            No
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        {listing.listing_url ? (
                          <a
                            href={
                              listing.listing_url
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-blue-600 hover:underline"
                          >
                            View listing
                          </a>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400">
                            No link
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}