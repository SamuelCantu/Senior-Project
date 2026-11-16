"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";

type ListingDraft = {
  id: string;
  product_id: string;
  generated_title: string;
  generated_category: string | null;
  generated_condition: string | null;
  suggested_price: number | string | null;
  status: string;
  created_at: string;

  productTitle: string;
};

export default function DraftsPage() {
  const router = useRouter();

  const [drafts, setDrafts] =
    useState<ListingDraft[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const supabase = createClient();

    async function loadDrafts() {
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
       * Load this user's unfinished / ready drafts.
       */
      const {
        data: draftRows,
        error: draftsError,
      } = await supabase
        .from("listing_drafts")
        .select(`
          id,
          product_id,
          generated_title,
          generated_category,
          generated_condition,
          suggested_price,
          status,
          created_at
        `)
        .eq("user_id", user.id)
        .in("status", [
          "GENERATED",
          "APPROVED",
        ])
        .order("created_at", {
          ascending: false,
        });

      if (draftsError) {
        console.error(
          "Draft listings error:",
          draftsError.message,
          draftsError.code,
          draftsError.details
        );

        setError(
          "Could not load your listing drafts."
        );

        setLoading(false);
        return;
      }

      /*
       * Get the central product titles.
       */
      const productIds = [
        ...new Set(
          (draftRows ?? []).map(
            (draft) => draft.product_id
          )
        ),
      ];

      if (productIds.length === 0) {
        setDrafts([]);
        setLoading(false);
        return;
      }

      const {
        data: products,
        error: productsError,
      } = await supabase
        .from("products")
        .select("id, title")
        .in("id", productIds);

      if (productsError) {
        console.error(
          "Draft product lookup error:",
          productsError
        );

        setError(
          "Could not load the products connected to your drafts."
        );

        setLoading(false);
        return;
      }

      const productTitleMap =
        new Map(
          (products ?? []).map(
            (product) => [
              product.id,
              product.title,
            ]
          )
        );

      const preparedDrafts =
        (draftRows ?? []).map(
          (draft) => ({
            ...draft,

            productTitle:
              productTitleMap.get(
                draft.product_id
              ) ?? "Unknown product",
          })
        );

      setDrafts(
        preparedDrafts as ListingDraft[]
      );

      setLoading(false);
    }

    loadDrafts();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">
          Loading drafts...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* HEADER */}

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

      {/* CONTENT */}

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <p className="mb-2 font-semibold text-blue-600">
            Listing Preparation
          </p>

          <h1 className="text-3xl font-bold">
            Draft Listings
          </h1>

          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Review AI-generated listings before
            publishing them to a marketplace.
          </p>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {/* EMPTY STATE */}

        {!error && drafts.length === 0 && (
          <div className="rounded-xl border bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <h2 className="text-xl font-semibold">
              No drafts yet
            </h2>

            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Generate an AI-assisted listing and it
              will appear here.
            </p>

            <Link
              href="/ai"
              className="mt-5 inline-block font-semibold text-blue-600 hover:underline"
            >
              Go to AI Listing →
            </Link>
          </div>
        )}

        {/* DRAFT TABLE */}

        {!error && drafts.length > 0 && (
          <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <table className="w-full text-left">
              <thead className="border-b bg-gray-50 text-sm dark:border-gray-700 dark:bg-gray-800">
                <tr>
                  <th className="px-5 py-4">
                    Listing
                  </th>

                  <th className="px-5 py-4">
                    Category
                  </th>

                  <th className="px-5 py-4">
                    Condition
                  </th>

                  <th className="px-5 py-4">
                    Price
                  </th>

                  <th className="px-5 py-4">
                    Status
                  </th>

                  <th className="px-5 py-4">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {drafts.map((draft) => (
                  <tr
                    key={draft.id}
                    className="border-b last:border-b-0 dark:border-gray-700"
                  >
                    {/* TITLE */}

                    <td className="px-5 py-4">
                      <p className="font-medium">
                        {draft.generated_title}
                      </p>

                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Product: {draft.productTitle}
                      </p>
                    </td>

                    {/* CATEGORY */}

                    <td className="px-5 py-4">
                      {draft.generated_category ||
                        "—"}
                    </td>

                    {/* CONDITION */}

                    <td className="px-5 py-4">
                      {draft.generated_condition ||
                        "—"}
                    </td>

                    {/* PRICE */}

                    <td className="px-5 py-4">
                      {draft.suggested_price !==
                      null
                        ? `$${Number(
                            draft.suggested_price
                          ).toFixed(2)}`
                        : "—"}
                    </td>

                    {/* STATUS */}

                    <td className="px-5 py-4">
                      {draft.status ===
                      "APPROVED" ? (
                        <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">
                          Ready
                        </span>
                      ) : (
                        <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-semibold text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
                          Needs Review
                        </span>
                      )}
                    </td>

                    {/* ACTION */}

                    <td className="px-5 py-4">
                      <Link
                        href="/ai"
                        className="font-semibold text-blue-600 hover:underline"
                      >
                        Open listing
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}