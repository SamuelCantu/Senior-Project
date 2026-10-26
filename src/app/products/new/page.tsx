"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type SelectedImage = {
  file: File;
  previewUrl: string;
};

export default function NewProductPage() {
  const router = useRouter();

  /*
   * =====================================================
   * PRODUCT FORM
   * =====================================================
   */

  const [title, setTitle] =
    useState("");

  const [sku, setSku] =
    useState("");

  const [description, setDescription] =
    useState("");

  const [category, setCategory] =
    useState("");

  const [price, setPrice] =
    useState("");

  const [quantity, setQuantity] =
    useState("1");

  /*
   * =====================================================
   * IMAGE STATE
   * =====================================================
   */

  const [
    selectedImages,
    setSelectedImages,
  ] = useState<SelectedImage[]>([]);

  /*
   * =====================================================
   * UI STATE
   * =====================================================
   */

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [message, setMessage] =
    useState("");

  /*
   * =====================================================
   * IMAGE SELECTION
   * =====================================================
   */

  function handleImageSelection(
    event: ChangeEvent<HTMLInputElement>
  ) {
    setError("");

    const files =
      Array.from(
        event.target.files ?? []
      );

    if (files.length === 0) {
      return;
    }

    /*
     * We already know HEIC caused problems with our
     * AI/image workflow, so keep intake to formats
     * we know work throughout ListNexus.
     */
    const supportedTypes =
      [
        "image/jpeg",
        "image/png",
        "image/webp",
      ];

    const invalidFile =
      files.find(
        (file) =>
          !supportedTypes.includes(
            file.type
          )
      );

    if (invalidFile) {
      setError(
        `Unsupported image format: ${invalidFile.name}. Please use JPG, PNG, or WebP.`
      );

      event.target.value =
        "";

      return;
    }

    /*
     * Keep the demo reasonable.
     */
    if (
      selectedImages.length +
        files.length >
      8
    ) {
      setError(
        "You can upload up to 8 product images."
      );

      event.target.value =
        "";

      return;
    }

    const newImages =
      files.map(
        (file) => ({
          file,

          previewUrl:
            URL.createObjectURL(
              file
            ),
        })
      );

    setSelectedImages(
      (current) => [
        ...current,
        ...newImages,
      ]
    );

    /*
     * Allows selecting the same file again later.
     */
    event.target.value =
      "";
  }

  /*
   * =====================================================
   * REMOVE IMAGE
   * =====================================================
   */

  function removeImage(
    indexToRemove: number
  ) {
    setSelectedImages(
      (current) => {
        const image =
          current[
            indexToRemove
          ];

        if (image) {
          URL.revokeObjectURL(
            image.previewUrl
          );
        }

        return current.filter(
          (_, index) =>
            index !==
            indexToRemove
        );
      }
    );
  }

  /*
   * =====================================================
   * SAVE PRODUCT
   * =====================================================
   */

  async function handleSaveProduct() {
    setError("");
    setMessage("");

    /*
     * ------------------------------
     * Basic validation
     * ------------------------------
     */

    if (!title.trim()) {
      setError(
        "Please enter a product title."
      );

      return;
    }

    if (!sku.trim()) {
      setError(
        "Please enter a SKU."
      );

      return;
    }

    const numericPrice =
      Number(price);

    if (
      !Number.isFinite(
        numericPrice
      ) ||
      numericPrice < 0
    ) {
      setError(
        "Please enter a valid price."
      );

      return;
    }

    const numericQuantity =
      Number(quantity);

    if (
      !Number.isInteger(
        numericQuantity
      ) ||
      numericQuantity < 0
    ) {
      setError(
        "Quantity must be a whole number that is 0 or greater."
      );

      return;
    }

    if (
      selectedImages.length ===
      0
    ) {
      setError(
        "Please add at least one product image."
      );

      return;
    }

    setSaving(true);

    const supabase =
      createClient();

    try {
      /*
       * =================================================
       * GET CURRENT USER
       * =================================================
       */

      const {
        data: {
          user,
        },
        error: userError,
      } =
        await supabase.auth.getUser();

      if (
        userError ||
        !user
      ) {
        throw new Error(
          "You must be logged into ListNexus to add a product."
        );
      }

      /*
       * =================================================
       * CREATE CENTRAL PRODUCT
       * =================================================
       */

      const productStatus =
        numericQuantity > 0
          ? "AVAILABLE"
          : "SOLD_OUT";

      const {
        data: product,
        error: productError,
      } = await supabase
        .from("products")
        .insert({
          user_id:
            user.id,

          title:
            title.trim(),

          description:
            description.trim() ||
            null,

          sku:
            sku.trim(),

          price:
            numericPrice,

          quantity:
            numericQuantity,

          status:
            productStatus,

          category:
            category.trim() ||
            null,
        })
        .select(`
          id,
          title,
          sku
        `)
        .single();

      if (
        productError ||
        !product
      ) {
        console.error(
          productError
        );

        throw new Error(
          productError?.message ||
            "ListNexus could not create the product."
        );
      }

      /*
       * =================================================
       * UPLOAD IMAGES
       * =================================================
       */

      const imageRows: {
        product_id: string;
        image_url: string;
        storage_path: string;
        sort_order: number;
        is_primary: boolean;
      }[] = [];

      for (
        let index = 0;
        index <
        selectedImages.length;
        index++
      ) {
        const selectedImage =
          selectedImages[index];

        const file =
          selectedImage.file;

        /*
         * Clean the original filename.
         */
        const safeFilename =
          file.name.replace(
            /[^a-zA-Z0-9._-]/g,
            "-"
          );

        /*
         * Every user's uploads live inside their
         * own folder.
         *
         * Example:
         *
         * userUUID/productUUID/12345-front.jpg
         */
        const storagePath =
          `${user.id}/` +
          `${product.id}/` +
          `${Date.now()}-${index}-${safeFilename}`;

        const {
          error: uploadError,
        } =
          await supabase.storage
            .from(
              "product-images"
            )
            .upload(
              storagePath,
              file,
              {
                cacheControl:
                  "3600",

                upsert:
                  false,

                contentType:
                  file.type,
              }
            );

        if (uploadError) {
          console.error(
            uploadError
          );

          throw new Error(
            `Could not upload ${file.name}: ${uploadError.message}`
          );
        }

        /*
         * product-images is a public bucket, so obtain
         * the URL that AI/eBay can access later.
         */
        const {
          data:
            publicUrlData,
        } =
          supabase.storage
            .from(
              "product-images"
            )
            .getPublicUrl(
              storagePath
            );

        imageRows.push({
          product_id:
            product.id,

          image_url:
            publicUrlData.publicUrl,

          storage_path:
            storagePath,

          sort_order:
            index,

          /*
           * First image becomes primary image.
           */
          is_primary:
            index === 0,
        });
      }

      /*
       * =================================================
       * SAVE IMAGE RECORDS
       * =================================================
       */

      const {
        error:
          imageInsertError,
      } = await supabase
        .from(
          "product_images"
        )
        .insert(
          imageRows
        );

      if (
        imageInsertError
      ) {
        console.error(
          imageInsertError
        );

        throw new Error(
          imageInsertError.message ||
            "Images were uploaded, but ListNexus could not save the image records."
        );
      }

      /*
       * =================================================
       * SUCCESS
       * =================================================
       */

      setMessage(
        "Product created successfully!"
      );

      /*
       * /ai loads newest products first, so the product
       * we just created should become the first product.
       */
      router.push(
        "/ai"
      );
    } catch (
      saveError
    ) {
      console.error(
        saveError
      );

      if (
        saveError instanceof Error
      ) {
        setError(
          saveError.message
        );
      } else {
        setError(
          "Something went wrong while creating the product."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  /*
   * =====================================================
   * PAGE
   * =====================================================
   */

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* NAVIGATION */}

      <nav className="flex items-center justify-between bg-white px-10 py-6 shadow-sm">
        <a
          href="/"
          className="text-2xl font-bold text-blue-600"
        >
          ListNexus
        </a>

        <div className="flex gap-6 text-sm font-medium">
          <a
            href="/"
            className="hover:text-blue-600"
          >
            Home
          </a>

          <a
            href="/ai"
            className="hover:text-blue-600"
          >
            AI Listing
          </a>
        </div>
      </nav>

      {/* CONTENT */}

      <section className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="mb-2 font-semibold text-blue-600">
            Central Inventory
          </p>

          <h1 className="text-4xl font-bold">
            Add New Product
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-gray-600">
            Add a product to ListNexus, upload its
            photos, and then generate an AI-assisted
            marketplace listing.
          </p>
        </div>

        <div className="rounded-xl border bg-white p-8 shadow-sm">
          <div className="space-y-6">
            {/* TITLE */}

            <div>
              <label className="mb-2 block font-semibold">
                Product Title
                <span className="ml-1 text-red-600">
                  *
                </span>
              </label>

              <input
                type="text"
                value={
                  title
                }
                onChange={(
                  event
                ) =>
                  setTitle(
                    event.target.value
                  )
                }
                placeholder="Example: Bulbasaur Pokémon Card"
                className="w-full rounded-lg border px-4 py-3"
              />
            </div>

            {/* SKU */}

            <div>
              <label className="mb-2 block font-semibold">
                SKU
                <span className="ml-1 text-red-600">
                  *
                </span>
              </label>

              <input
                type="text"
                value={
                  sku
                }
                onChange={(
                  event
                ) =>
                  setSku(
                    event.target.value
                  )
                }
                placeholder="Example: PKM-BULB-001"
                className="w-full rounded-lg border px-4 py-3"
              />

              <p className="mt-1 text-xs text-gray-500">
                This becomes the centralized identifier
                used when syncing the product to
                marketplaces.
              </p>
            </div>

            {/* CATEGORY */}

            <div>
              <label className="mb-2 block font-semibold">
                Central Category
              </label>

              <input
                type="text"
                value={
                  category
                }
                onChange={(
                  event
                ) =>
                  setCategory(
                    event.target.value
                  )
                }
                placeholder="Example: Trading Cards"
                className="w-full rounded-lg border px-4 py-3"
              />
            </div>

            {/* NOTES */}

            <div>
              <label className="mb-2 block font-semibold">
                Seller Notes
              </label>

              <textarea
                value={
                  description
                }
                onChange={(
                  event
                ) =>
                  setDescription(
                    event.target.value
                  )
                }
                placeholder="Anything you already know about the item..."
                rows={4}
                className="w-full rounded-lg border px-4 py-3"
              />

              <p className="mt-1 text-xs text-gray-500">
                These notes give AI additional context.
                They are not automatically treated as
                the final marketplace description.
              </p>
            </div>

            {/* PRICE / QUANTITY */}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block font-semibold">
                  Base Price
                  <span className="ml-1 text-red-600">
                    *
                  </span>
                </label>

                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                    $
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={
                      price
                    }
                    onChange={(
                      event
                    ) =>
                      setPrice(
                        event.target.value
                      )
                    }
                    placeholder="9.99"
                    className="w-full rounded-lg border py-3 pl-8 pr-4"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block font-semibold">
                  Quantity
                  <span className="ml-1 text-red-600">
                    *
                  </span>
                </label>

                <input
                  type="number"
                  min="0"
                  step="1"
                  value={
                    quantity
                  }
                  onChange={(
                    event
                  ) =>
                    setQuantity(
                      event.target.value
                    )
                  }
                  className="w-full rounded-lg border px-4 py-3"
                />
              </div>
            </div>

            {/* IMAGES */}

            <div>
              <label className="mb-2 block font-semibold">
                Product Photos
                <span className="ml-1 text-red-600">
                  *
                </span>
              </label>

              <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
                <input
                  id="product-images"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  multiple
                  onChange={
                    handleImageSelection
                  }
                  className="hidden"
                />

                <label
                  htmlFor="product-images"
                  className="inline-block cursor-pointer rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
                >
                  Take or Upload Photos
                </label>

                <p className="mt-3 text-sm text-gray-500">
                  JPG, PNG, or WebP. Up to 8 images.
                </p>

                <p className="mt-1 text-xs text-gray-400">
                  The first image becomes the primary
                  marketplace image.
                </p>
              </div>
            </div>

            {/* IMAGE PREVIEWS */}

            {selectedImages.length >
              0 && (
              <div>
                <h3 className="mb-3 font-semibold">
                  Selected Photos
                </h3>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {selectedImages.map(
                    (
                      image,
                      index
                    ) => (
                      <div
                        key={
                          `${image.file.name}-${index}`
                        }
                        className="overflow-hidden rounded-lg border"
                      >
                        <img
                          src={
                            image.previewUrl
                          }
                          alt={`Selected product image ${
                            index + 1
                          }`}
                          className="h-44 w-full object-contain bg-gray-50"
                        />

                        <div className="p-3">
                          <p className="truncate text-xs text-gray-500">
                            {
                              image.file.name
                            }
                          </p>

                          {index ===
                            0 && (
                            <p className="mt-1 text-xs font-semibold text-blue-600">
                              Primary image
                            </p>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              removeImage(
                                index
                              )
                            }
                            disabled={
                              saving
                            }
                            className="mt-2 text-sm font-semibold text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* ERROR */}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
                {error}
              </div>
            )}

            {/* SUCCESS */}

            {message && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
                {message}
              </div>
            )}

            {/* SAVE */}

            <button
              type="button"
              onClick={
                handleSaveProduct
              }
              disabled={
                saving
              }
              className="w-full rounded-lg bg-green-600 px-6 py-4 text-lg font-semibold text-white hover:bg-green-700 disabled:bg-gray-400"
            >
              {saving
                ? "Saving Product & Uploading Photos..."
                : "Save Product & Continue to AI"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}