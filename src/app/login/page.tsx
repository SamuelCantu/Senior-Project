"use client";

// React state lets us keep track of the form fields
// and any login error message.
import { useState } from "react";

// Link lets the user return to the homepage.
import Link from "next/link";

// Router lets us redirect the user after a successful login.
import { useRouter } from "next/navigation";

// Imports the Supabase browser client we created.
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  // Stores the email entered by the user.
  const [email, setEmail] = useState("");

  // Stores the password entered by the user.
  const [password, setPassword] = useState("");

  // Stores any error message returned by Supabase.
  const [error, setError] = useState("");

  // Tracks whether the login request is currently running.
  const [loading, setLoading] = useState(false);

  // Runs when the user submits the login form.
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    // Prevents the browser from refreshing the page.
    event.preventDefault();

    // Clear any previous error message.
    setError("");

    // Disable the button while the login request is running.
    setLoading(true);

    // Create a connection to Supabase.
    const supabase = createClient();

    // Ask Supabase to verify the user's email and password.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If Supabase returns an error, show the real error message.
    // This is useful while we are testing/debugging.
    if (error) {
      console.error("Supabase login error:", error);

      setError(error.message);

      setLoading(false);

      return;
    }

    // If login succeeds, send the user back to the homepage.
    router.push("/");

    // Refresh the page so Next.js knows the auth state changed.
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">
        
        {/* Project name */}
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>

        {/* Login page title */}
        <h2 className="mb-3 text-center text-2xl font-semibold">
          Log in
        </h2>

        {/* Short description */}
        <p className="mb-8 text-center text-gray-600">
          Sign in to manage your listings and inventory.
        </p>

        {/* Login form */}
        <form onSubmit={handleLogin} className="space-y-5">
          
          {/* Email field */}
          <div>
            <label
              htmlFor="email"
              className="mb-2 block font-medium"
            >
              Email
            </label>

            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border px-4 py-3"
              placeholder="you@example.com"
            />
          </div>

          {/* Password field */}
          <div>
            <label
              htmlFor="password"
              className="mb-2 block font-medium"
            >
              Password
            </label>

            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border px-4 py-3"
              placeholder="Enter your password"
            />
          </div>

          {/* Displays the real Supabase error while testing */}
          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Login button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Log in"}
          </button>
        </form>

        {/* Link back to homepage */}
        <div className="mt-6 text-center">
          <Link
            className="text-blue-600 hover:underline"
            href="/"
          >
            Back to home
          </Link>
        </div>

      </section>
    </main>
  );
}