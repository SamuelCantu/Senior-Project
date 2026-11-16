"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";

type InventoryProduct = {
  id: string;
  title: string;
  sku: string;
  price: number | string;
  quantity: number;
  status: string;
  category: string | null;
};

export default function InventoryPage() {
  const router = useRouter();

  const [products, setProducts] =
    useState<InventoryProduct[]>([]);

  const [quantityInputs, setQuantityInputs] =
    useState<Record<string, string>>({});

  const [savingProductId, setSavingProductId] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  useEffect(() => {
    const supabase = createClient();

    async function loadInventory() {
      setLoading(true);
      setError("");

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const {
        data,
        error: productsError,
      } = await supabase
        .from("products")
        .select(`
          id,
          title,
          sku,
          price,
          quantity,
          status,
          category
        `)
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: false,
        });

      if (productsError) {
        console.error(
          "Inventory error:",
          productsError.message,
          productsError.code,
          productsError.details
        );

        setError(
          "Could not load your inventory."
        );

        setLoading(false);
        return;
      }

      const loadedProducts =
        (data ?? []) as InventoryProduct[];

      setProducts(loadedProducts);

      const initialQuantityInputs:
        Record<string, string> = {};

      for (const product of loadedProducts) {
        initialQuantityInputs[
          product.id
        ] = product.quantity.toString();
      }

      setQuantityInputs(
        initialQuantityInputs
      );

      setLoading(false);
    }

    loadInventory();
  }, [router]);

  async function handleSaveQuantity(
    product: InventoryProduct
  ) {
    const quantityValue =
      quantityInputs[product.id];

    const newQuantity =
      Number(quantityValue);

    if (
      !Number.isInteger(newQuantity) ||
      newQuantity < 0
    ) {
      setError(
        "Quantity must be a whole number that is 0 or greater."
      );

      return;
    }

    setSavingProductId(product.id);

    setError("");
    setMessage("");

    const supabase = createClient();

    let newStatus =
      product.status;

    if (
      newQuantity === 0 &&
      product.status === "AVAILABLE"
    ) {
      newStatus = "SOLD_OUT";
    }

    if (
      newQuantity > 0 &&
      product.status === "SOLD_OUT"
    ) {
      newStatus = "AVAILABLE";
    }

    const {
      data: updatedProduct,
      error: updateError,
    } = await supabase
      .from("products")
      .update({
        quantity: newQuantity,
        status: newStatus,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", product.id)
      .select(`
        id,
        quantity,
        status
      `)
      .single();

    if (
      updateError ||
      !updatedProduct
    ) {
      console.error(
        "Quantity update error:",
        updateError
      );

      setError(
        "Could not update the product quantity."
      );

      setSavingProductId(null);
      return;
    }

    setProducts(
      (currentProducts) =>
        currentProducts.map(
          (currentProduct) =>
            currentProduct.id ===
            product.id
              ? {
                  ...currentProduct,

                  quantity:
                    updatedProduct.quantity,

                  status:
                    updatedProduct.status,
                }
              : currentProduct
        )
    );

    setQuantityInputs(
      (currentInputs) => ({
        ...currentInputs,

        [product.id]:
          updatedProduct.quantity.toString(),
      })
    );

    setMessage(
      `${product.title} quantity updated to ${updatedProduct.quantity}.`
    );

    setSavingProductId(null);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">
          Loading inventory...
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
            Central Inventory
          </p>

          <h1 className="text-3xl font-bold">
            Inventory Items
          </h1>

          <p className="mt-2 text-gray-600 dark:text-gray-400">
            View your ListNexus products and update
            available quantity.
          </p>
        </div>

        {/* ERROR */}

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {/* SUCCESS */}

        {message && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            {message}
          </div>
        )}

        {/* EMPTY */}

        {!error &&
          products.length === 0 && (
            <div className="rounded-xl border bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <h2 className="text-xl font-semibold">
                No inventory items yet
              </h2>

              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Add a product to begin managing
                your inventory.
              </p>

              <Link
                href="/products/new"
                className="mt-5 inline-block font-semibold text-blue-600 hover:underline"
              >
                Add product →
              </Link>
            </div>
          )}

        {/* TABLE */}

        {!error &&
          products.length > 0 && (
            <div className="overflow-x-auto rounded-xl border bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <table className="w-full text-left">
                <thead className="border-b bg-gray-50 text-sm dark:border-gray-700 dark:bg-gray-800">
                  <tr>
                    <th className="px-5 py-4">
                      Item
                    </th>

                    <th className="px-5 py-4">
                      SKU
                    </th>

                    <th className="px-5 py-4">
                      Category
                    </th>

                    <th className="px-5 py-4">
                      Price
                    </th>

                    <th className="px-5 py-4">
                      Status
                    </th>

                    <th className="px-5 py-4">
                      Quantity
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {products.map(
                    (product) => (
                      <tr
                        key={product.id}
                        className="border-b last:border-b-0 dark:border-gray-700"
                      >
                        {/* ITEM */}

                        <td className="px-5 py-4 font-medium">
                          {product.title}
                        </td>

                        {/* SKU */}

                        <td className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                          {product.sku}
                        </td>

                        {/* CATEGORY */}

                        <td className="px-5 py-4">
                          {product.category ||
                            "—"}
                        </td>

                        {/* PRICE */}

                        <td className="px-5 py-4">
                          $
                          {Number(
                            product.price
                          ).toFixed(2)}
                        </td>

                        {/* STATUS */}

                        <td className="px-5 py-4">
                          {product.status ===
                          "AVAILABLE" ? (
                            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">
                              Available
                            </span>
                          ) : (
                            <span className="rounded-full bg-gray-200 px-3 py-1 text-sm font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                              {product.status ===
                              "SOLD_OUT"
                                ? "Sold Out"
                                : product.status}
                            </span>
                          )}
                        </td>

                        {/* QUANTITY */}

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={
                                quantityInputs[
                                  product.id
                                ] ?? ""
                              }
                              onChange={(
                                event
                              ) =>
                                setQuantityInputs(
                                  (
                                    currentInputs
                                  ) => ({
                                    ...currentInputs,

                                    [product.id]:
                                      event
                                        .target
                                        .value,
                                  })
                                )
                              }
                              className="w-20 rounded-lg border px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            />

                            <button
                              type="button"
                              onClick={() =>
                                handleSaveQuantity(
                                  product
                                )
                              }
                              disabled={
                                savingProductId ===
                                product.id
                              }
                              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
                            >
                              {savingProductId ===
                              product.id
                                ? "Saving..."
                                : "Save"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </main>
  );
}