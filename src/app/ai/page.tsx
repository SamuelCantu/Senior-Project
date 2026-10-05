"use client";

import { FormEvent, useState } from "react";

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

  const [result, setResult] = useState<ListingResult | null>(null);

  // Tracks loading/error/success states for Gemini and eBay requests
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Sends the seller's listing information to the Gemini API route
  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Reset previous messages/results before making a new request
    setLoading(true);
    setError("");
    setMessage("");
    setResult(null);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },

        // Send the current seller-entered information to Gemini
        body: JSON.stringify({
          title,
          description,
          priceMin: Number(priceMin),
          priceMax: Number(priceMax),
        }),
      });

      const data = await response.json();

      // If the Gemini route returns an error, display it to the user
      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong while generating the listing."
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

  // Copies Gemini's suggested values back into the editable listing form
  // so the seller can review or modify them before posting
  function handleUseAISuggestion() {
    if (!result) return;

    setTitle(result.title);
    setDescription(result.description);
    setPriceMin(result.suggested_price_min.toString());
    setPriceMax(result.suggested_price_max.toString());

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

            {/* eBay button appears after Gemini has generated a listing */}
            {result && (
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
                  <h3 className="font-semibold text-gray-700">
                    Suggested Title
                  </h3>

                  <p>{result.title}</p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-700">
                    Enhanced Description
                  </h3>

                  <p>{result.description}</p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-700">
                    Suggested Category
                  </h3>

                  <p>{result.category}</p>
                </div>

                <div>
                  <h3 className="font-semibold text-gray-700">
                    Suggested Price Range
                  </h3>

                  <p>
                    ${result.suggested_price_min} - $
                    {result.suggested_price_max}
                  </p>
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
                  <h3 className="font-semibold text-gray-700">
                    Needs Confirmation
                  </h3>

                  {result.needs_confirmation.length > 0 ? (
                    <ul className="ml-5 list-disc">
                      {result.needs_confirmation.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>None</p>
                  )}
                </div>

                {/* Apply Gemini's enhanced title, description, and price */}
                <button
                  type="button"
                  onClick={handleUseAISuggestion}
                  className="w-full rounded-lg bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700"
                >
                  Use AI Suggestion
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}