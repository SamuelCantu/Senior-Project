"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleResetPassword(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setMessage("");
    setLoading(true);

    const supabase = createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}/login/reset-password`,
      }
    );

    if (error) {
      console.error("Password reset error:", error);
      setError(error.message);
      setLoading(false);
      return;
    }

    setMessage(
      "If an account exists for that email, a password reset link has been sent."
    );

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>

        <h2 className="mb-3 text-center text-2xl font-semibold">
          Reset your password
        </h2>

        <p className="mb-8 text-center text-gray-600">
          Enter your email address and we will send you a password reset link.
        </p>

        <form
          onSubmit={handleResetPassword}
          className="space-y-5"
        >
          <div>
            <label
              className="mb-2 block font-medium"
              htmlFor="email"
            >
              Email
            </label>

            <input
              className="w-full rounded-lg border px-4 py-3"
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          {message && (
            <p className="text-sm text-green-700">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link
            href="/login"
            className="text-blue-600 hover:underline"
          >
            Back to login
          </Link>
        </div>
      </section>
    </main>
  );
}