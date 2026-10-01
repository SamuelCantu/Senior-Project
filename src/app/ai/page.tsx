"use client";

import { FormEvent, useState } from "react";

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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const [result, setResult] = useState<ListingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description,
          priceMin: Number(priceMin),
          priceMax: Number(priceMax),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong while generating the listing."
        );
      }

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

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <nav className="flex items-center justify-between bg-white px-10 py-6 shadow-sm">
        <a href="/" className="text-2xl font-bold text-blue-600">
          ListNexus
        </a>

        <a href="/" className="text-sm font-medium hover:text-blue-600">
          Home
        </a>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="mb-2 font-semibold text-blue-600">
            AI-Assisted Listing
          </p>

          <h1 className="mb-4 text-4xl font-bold">
            Generate a Product Listing
          </h1>

          <p className="text-gray-600">
            Enter some basic information about your item and ListNexus will use
            Gemini to suggest an enhanced marketplace listing.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Input Form */}
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border bg-white p-6 shadow-sm"
          >
            <h2 className="mb-6 text-2xl font-semibold">
              Product Information
            </h2>

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

            <div className="mb-4">
              <label className="mb-2 block font-medium">
                Short Description
              </label>

              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full rounded-lg border px-4 py-2"
                placeholder="Please enter a short description"
                rows={5}
                required
              />
            </div>

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

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
            >
              {loading ? "Generating..." : "Generate Listing"}
            </button>

            {error && (
              <p className="mt-4 text-red-600">
                {error}
              </p>
            )}
          </form>

          {/* Gemini Result */}
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="mb-6 text-2xl font-semibold">
              AI Suggestion
            </h2>

            {!result && !loading && (
              <p className="text-gray-500">
                Your generated listing will appear here.
              </p>
            )}

            {loading && (
              <p className="text-gray-500">
                Gemini is generating your listing...
              </p>
            )}

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
                    Description
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
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}