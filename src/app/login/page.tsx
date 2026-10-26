"use client";

// React state lets us keep track of the form fields
// and any login error message.
import { useEffect, useState } from "react";

// Link lets the user navigate to other pages.
import Link from "next/link";

// Router lets us redirect the user after a successful login.
import { useRouter } from "next/navigation";

// Imports the Supabase browser client.
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();

  //Keeps logged in users away from login page
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Stores the email entered by the user.
  const [email, setEmail] = useState("");

  // Stores the password entered by the user.
  const [password, setPassword] = useState("");

  // Stores any error message returned by Supabase.
  const [error, setError] = useState("");

  // Tracks whether login is currently processing.
  const [loading, setLoading] = useState(false);

  //Runs to keep logged in users away
  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        router.push("/dashboard");
        return;
      }

      setCheckingAuth(false);
    }

    checkAuth();
  }, [router]);

  // Runs when the login form is submitted.
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    // Prevent the browser from refreshing the page.
    event.preventDefault();

    setError("");
    setLoading(true);

    // Create a connection to Supabase.
    const supabase = createClient();

    // Ask Supabase to verify the email and password.
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // Display an error if login fails.
    if (error) {
      console.error("Supabase login error:", error);

      setError(error.message);
      setLoading(false);

      return;
    }

    // Send the user to the dashboard after login.
    router.push("/dashboard");
    router.refresh();
  }

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">

        {/* Project name */}
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>

        {/* Login heading */}
        <h2 className="mb-3 text-center text-2xl font-semibold">
          Log in
        </h2>

        {/* Page description */}
        <p className="mb-8 text-center text-gray-600">
          Sign in to manage your listings and inventory.
        </p>

        {/* Login form */}
        <form onSubmit={handleLogin} className="space-y-5">

          {/* Email field */}
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

          {/* Password field */}
          <div>
            <label
              className="mb-2 block font-medium"
              htmlFor="password"
            >
              Password
            </label>

            <input
              className="w-full rounded-lg border px-4 py-3"
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
          </div>

          <div className="text-right">
            <Link
              href="/login/forgot-password"
              className="text-sm text-blue-600 hover:underline"
            >
              Forgot password?
            </Link>
          </div>

          {/* Supabase error message */}
          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Login button */}
          <button
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Log in"}
          </button>

        </form>

        {/* Navigation links */}
        <div className="mt-6 flex flex-col gap-3 text-center text-sm">

          {/* Return to homepage */}
          <Link
            className="text-blue-600 hover:underline"
            href="/"
          >
            Back to home
          </Link>

          {/* Registration page */}
          <Link
            className="text-blue-600 hover:underline"
            href="/register"
          >
            Register
          </Link>

        </div>

      </section>
    </main>
  );
}