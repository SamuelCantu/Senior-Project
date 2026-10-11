"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

// Structure of the response returned by the Gemini API route
type ListingResult = {
  title: string;
  description: string;
  category: string;
  suggested_price_min: number;
  suggested_price_max: number;
  attributes: string[];
  needs_confirmation: string[];
};

export default function GenerateListingPage() {
  // Seller-editable listing information
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [images, setImages] = useState<File[]>([]); //Product images selected by the seller
  const [imagePreviews, setImagePreviews] = useState<string[]>([]); //Browser preview URLs for selected images
  const [selectedMarketplaces, setSelectedMarketplaces] = useState<string[]>([]);
  const [result, setResult] = useState<ListingResult | null>(null);

  // Tracks loading/error/success states for Gemini and eBay requests
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [aiApplied, setAiApplied] = useState(false);

  // Handles product image selection
  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);

    setError("");

    // Only allow common image formats
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    const invalidFile = selectedFiles.find(
      (file) => !allowedTypes.includes(file.type)
    );

    if (invalidFile) {
      setError("Images must be JPEG, PNG, or WebP.");
      event.target.value = "";
      return;
    }

    // Keep individual images reasonably small for API requests
    const oversizedFile = selectedFiles.find(
      (file) => file.size > 5 * 1024 * 1024
    );

    if (oversizedFile) {
      setError("Each image must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    if (selectedFiles.length > 5) {
      setError("You can upload a maximum of 5 images.");
      event.target.value = "";
      return;
    }

    setImages(selectedFiles);

    // Create temporary browser URLs so the seller can preview the images
    const previews = selectedFiles.map((file) =>
      URL.createObjectURL(file)
    );

    setImagePreviews(previews);
  }

  // Removes one selected image before sending the listing to Gemini
  function handleRemoveImage(indexToRemove: number) {
    setImages((currentImages) =>
      currentImages.filter((_, index) => index !== indexToRemove)
    );

    setImagePreviews((currentPreviews) => {
      URL.revokeObjectURL(currentPreviews[indexToRemove]);

      return currentPreviews.filter(
        (_, index) => index !== indexToRemove
      );
    });
  }
  
  // Clean up temporary image preview URLs when the page is closed
  useEffect(() => {
    return () => {
      imagePreviews.forEach((preview) =>
        URL.revokeObjectURL(preview)
      );
    };
  }, [imagePreviews]);

  function handleMarketplaceChange(marketplace: string) {
    setSelectedMarketplaces((current) =>
      current.includes(marketplace)
        ? current.filter((item) => item !== marketplace)
        : [...current, marketplace]
    );
  }

  // Sends the seller's listing information to the Gemini API route
  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Reset previous messages/results before making a new request
    setLoading(true);
    setError("");
    setMessage("");
    setResult(null);
    setAiApplied(false);
    setSelectedMarketplaces([]);

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (!trimmedTitle) {
      setError("Please enter a title.");
      return;
    }

    if (!trimmedDescription) {
      setError("Please enter a description.");
      return;
    }

    if (Number(priceMin) > Number(priceMax)) {
      setError("Minimum price cannot be greater than maximum price.");
      return;
    }

    //Requires between 2 and 5 product images
    if (images.length < 2 || images.length > 5){
      setError("Please upload between 2 and 5 product images.");
      return;
    }

    try {
      // FormData allows text fields and image files to be sent together
      const formData = new FormData();

      formData.append("title", trimmedTitle);
      formData.append("description", trimmedDescription);
      formData.append("priceMin", priceMin);
      formData.append("priceMax", priceMax);

      images.forEach((image) => {
        formData.append("images", image);
      });

      const response = await fetch("/api/gemini", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      // If the Gemini route returns an error, display it to the user
      if (!response.ok) {
        throw new Error(
          data.error ||
            "Something went wrong while generating the listing."
        );
      }

      // Save the structured Gemini response so it can be displayed
      setResult(data);
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  // Updates an individual field in the AI-generated result.
  // This allows the seller to edit Gemini's suggestion before applying it.
  function updateResultField<K extends keyof ListingResult>(
    field: K,
    value: ListingResult[K]
  ) {
    setResult((currentResult) => {
      if (!currentResult) return currentResult;

      return {
        ...currentResult,
        [field]: value,
      };
    });
  }

  // Copies Gemini's suggested values back into the editable listing form
  // so the seller can review or modify them before posting
  function handleUseAISuggestion() {
    if (!result) return;

    setTitle(result.title);
    setDescription(result.description);
    setPriceMin(result.suggested_price_min.toString());
    setPriceMax(result.suggested_price_max.toString());
    setAiApplied(true);

    setMessage(
      "AI suggestion applied. You can review or edit the listing before posting."
    );
  }

  // Sends the finalized listing to the eBay API route
  async function handlePostToEbay() {
    setPosting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/ebay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        // Send the approved listing information to eBay
        body: JSON.stringify({
          title,
          description,

          // Temporary demo behavior:
          // use the minimum suggested price as the listing price
          price: Number(priceMin),

          // Include Gemini-generated category/attributes when available
          category: result?.category ?? "",
          attributes: result?.attributes ?? [],
        }),
      });

      const data = await response.json();

      // Display any error returned by the eBay route
      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong while posting to eBay."
        );
      }

      // If eBay returns a listing ID, show it to the user
      setMessage(
        `Listing sent to eBay successfully${
          data.listingId ? `. Listing ID: ${data.listingId}` : "."
        }`
      );
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Something went wrong while posting to eBay.");
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      {/* Top navigation bar */}
      <nav className="flex items-center justify-between bg-white px-10 py-6 shadow-sm">
        <a href="/" className="text-2xl font-bold text-blue-600">
          ListNexus
        </a>

        <div className="flex gap-6 text-sm font-medium">
          <a href="/" className="hover:text-blue-600">
            Home
          </a>

          <a href="/login" className="hover:text-blue-600">
            Log in
          </a>
        </div>
      </nav>

      {/* Main listing-generation area */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="mb-2 font-semibold text-blue-600">
            AI-Assisted Listing
          </p>

          <h1 className="mb-4 text-4xl font-bold">
            Create a Product Listing
          </h1>

          <p className="mx-auto max-w-2xl text-gray-600">
            Enter some basic information about your item. Gemini can suggest an
            enhanced title, description, category, price range, and useful item
            attributes.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Left side: seller-entered listing information */}
          <form
            onSubmit={handleGenerate}
            className="rounded-xl border bg-white p-6 shadow-sm"
          >
            <h2 className="mb-6 text-2xl font-semibold">
              Product Information
            </h2>

            {/* Product title */}
            <div className="mb-4">
              <label className="mb-2 block font-medium">
                Title
              </label>

              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-lg border px-4 py-2"
                placeholder="Please enter title"
                required
              />
            </div>

            {/* Basic seller-provided description */}
            <div className="mb-4">
              <label className="mb-2 block font-medium">
                Description
              </label>

              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-lg border px-4 py-2"
                placeholder="Please enter a short description"
                rows={6}
                required
              />
            </div>

            {/* Product image upload */}
            <div className="mb-6">
              <label className="mb-2 block font-medium">
                Product Images
              </label>

              <p className="mb-3 text-sm text-gray-500">
                Upload 2–5 images of the item. JPEG, PNG, and WebP are supported.
              </p>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleImageChange}
                className="w-full rounded-lg border px-4 py-2"
              />

              <p className="mt-2 text-sm text-gray-500">
                {images.length}/5 images selected
              </p>

              {/* Image previews */}
              {imagePreviews.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {imagePreviews.map((preview, index) => (
                    <div
                      key={preview}
                      className="relative overflow-hidden rounded-lg border bg-gray-50"
                    >
                      <img
                        src={preview}
                        alt={`Product preview ${index + 1}`}
                        className="h-32 w-full object-cover"
                      />

                      <button
                        type="button"
                        onClick={() => handleRemoveImage(index)}
                        className="absolute right-2 top-2 rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Price range the seller is willing to accept */}
            <div className="mb-6 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-2 block font-medium">
                  Minimum Price
                </label>

                <input
                  type="number"
                  value={priceMin}
                  onChange={(event) => setPriceMin(event.target.value)}
                  className="w-full rounded-lg border px-4 py-2"
                  placeholder="Minimum"
                  min="0"
                  step="0.01"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block font-medium">
                  Maximum Price
                </label>

                <input
                  type="number"
                  value={priceMax}
                  onChange={(event) => setPriceMax(event.target.value)}
                  className="w-full rounded-lg border px-4 py-2"
                  placeholder="Maximum"
                  min="0"
                  step="0.01"
                  required
                />
              </div>
            </div>

            {/* Ask Gemini to generate an enhanced listing */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? "Generating..." : "Generate AI Suggestion"}
            </button>

            {/* Marketplace selection */}
            {result && aiApplied && (
              <div className="mt-6 rounded-lg border bg-gray-50 p-4">
                <h3 className="mb-3 font-semibold text-gray-700">
                  Select Marketplaces
                </h3>

                <label className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedMarketplaces.includes("ebay")}
                    onChange={() => handleMarketplaceChange("ebay")}
                  />
                  <span>eBay</span>
                </label>

                <label className="mb-2 flex items-center gap-2 text-gray-400">
                  <input type="checkbox" disabled />
                  <span>Etsy (Coming Soon)</span>
                </label>

                <label className="flex items-center gap-2 text-gray-400">
                  <input type="checkbox" disabled />
                  <span>Depop (Coming Soon)</span>
                </label>
              </div>
            )}

            {/* eBay button appears after Gemini has generated a listing */}
            {result && aiApplied && selectedMarketplaces.includes("ebay") && (
              <button
                type="button"
                onClick={handlePostToEbay}
                disabled={posting}
                className="mt-4 w-full rounded-lg bg-gray-900 px-6 py-3 font-semibold text-white hover:bg-gray-800 disabled:bg-gray-400"
              >
                {posting ? "Posting..." : "Post Listing to eBay"}
              </button>
            )}

            {/* Error message */}
            {error && (
              <p className="mt-4 text-red-600">
                {error}
              </p>
            )}

            {/* Success/information message */}
            {message && (
              <p className="mt-4 text-green-700">
                {message}
              </p>
            )}
          </form>

          {/* Right side: Gemini-generated suggestion */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-6 text-2xl font-semibold">
              Gemini Suggestion
            </h2>

            {/* Initial state before Gemini has returned anything */}
            {!result && !loading && (
              <p className="text-gray-500">
                Your AI-enhanced listing will appear here.
              </p>
            )}

            {/* Display while waiting for Gemini */}
            {loading && (
              <p className="text-gray-500">
                Gemini is generating your listing...
              </p>
            )}

            {/* Display the structured Gemini response */}
            {result && (
              <div className="space-y-5">
                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Suggested Title
                  </label>

                  <input
                    type="text"
                    value={result.title}
                    onChange={(event) =>
                      updateResultField("title", event.target.value)
                    }
                    className="w-full rounded-lg border px-4 py-2"
                  />
                </div>

                <div>
                  <label className="mb-2 block font-semibold text-gray-700">
                    Enhanced Description
                  </label>

                  <textarea
                    value={result.description}
                    onChange={(event) =>
                      updateResultField("description", event.target.value)
                    }
                    className="w-full rounded-lg border px-4 py-2"
                    rows={6}
                  />
                </div>

                <div>
                  <h3 className="font-semibold text-gray-700">
                    Suggested Category
                  </h3>

                  <p>{result.category}</p>
                </div>

                <div>
                  <h3 className="mb-2 font-semibold text-gray-700">
                    Suggested Price Range
                  </h3>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm text-gray-500">
                        Minimum
                      </label>

                      <input
                        type="number"
                        value={result.suggested_price_min}
                        onChange={(event) =>
                          updateResultField(
                            "suggested_price_min",
                            Number(event.target.value)
                          )
                        }
                        className="w-full rounded-lg border px-4 py-2"
                        min="0"
                        step="0.01"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm text-gray-500">
                        Maximum
                      </label>

                      <input
                        type="number"
                        value={result.suggested_price_max}
                        onChange={(event) =>
                          updateResultField(
                            "suggested_price_max",
                            Number(event.target.value)
                          )
                        }
                        className="w-full rounded-lg border px-4 py-2"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                </div>

                {/* Flexible attributes depending on the type of item */}
                <div>
                  <h3 className="font-semibold text-gray-700">
                    Suggested Attributes
                  </h3>

                  {result.attributes.length > 0 ? (
                    <ul className="ml-5 list-disc">
                      {result.attributes.map((attribute, index) => (
                        <li key={index}>{attribute}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>None</p>
                  )}
                </div>

                {/* Information Gemini is uncertain about */}
                <div>
                  <h3 className="mb-2 font-semibold text-gray-700">
                    Needs Confirmation
                  </h3>

                  {result.needs_confirmation.length > 0 ? (
                    <div className="space-y-2">
                      {result.needs_confirmation.map((item, index) => (
                        <div
                          key={index}
                          className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-yellow-900"
                        >
                          <span className="font-semibold">Please confirm:</span>{" "}
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
                      No additional information needs confirmation.
                    </div>
                  )}
                </div>

                <p className="text-sm text-gray-500">
                  Review and edit the AI-generated information before applying it to your listing.
                </p>

                {/* Apply Gemini's enhanced title, description, and price */}
                <button
                  type="button"
                  onClick={handleUseAISuggestion}
                  className="w-full rounded-lg bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700"
                >
                  Apply AI Suggestion
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}