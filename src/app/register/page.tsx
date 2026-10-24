"use client";

// React state lets us store the values entered into the form.
import { useState, type FormEvent } from "react";

// Link lets the user navigate back to the login page.
import Link from "next/link";

// Imports the Supabase browser client we already created.
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  // Stores the user's name.
  const [name, setName] = useState("");

  // Stores the user's email.
  const [email, setEmail] = useState("");

  // Stores the user's password.
  const [password, setPassword] = useState("");

  // Displays success or error messages.
  const [message, setMessage] = useState("");

  // Keeps track of whether registration is currently processing.
  const [loading, setLoading] = useState(false);

  // Runs when the user submits the registration form.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Prevent the browser from refreshing the page.
    event.preventDefault();

    setMessage("");
    setLoading(true);

    // Connect to Supabase.
    const supabase = createClient();

    // Create the user's account using Supabase Authentication.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,

      // Stores the user's name in the authentication metadata.
      options: {
        data: {
          full_name: name,
        },
      },
    });

    // If Supabase returns an error, display it.
    if (error) {
      console.error("Supabase registration error:", error);

      setMessage(error.message);
      setLoading(false);

      return;
    }

    // If Supabase immediately creates a session,
    // email confirmation is probably disabled.
    if (data.session) {
      setMessage("Account created successfully. You can now log in.");
    } else {
      // If email confirmation is enabled, Supabase may require
      // the user to verify their email before logging in.
      setMessage(
        "Account created. Check your email to confirm your account before logging in."
      );
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">

        {/* Project name */}
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>

        {/* Registration page heading */}
        <h2 className="mb-3 text-center text-2xl font-semibold">
          Create an account
        </h2>

        {/* Registration form */}
        <form className="space-y-4" onSubmit={handleSubmit}>

          {/* Name field */}
          <div>
            <label
              className="mb-1 block text-sm font-medium"
              htmlFor="name"
            >
              Name
            </label>

            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              id="name"
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          {/* Email field */}
          <div>
            <label
              className="mb-1 block text-sm font-medium"
              htmlFor="email"
            >
              Email
            </label>

            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {/* Password field */}
          <div>
            <label
              className="mb-1 block text-sm font-medium"
              htmlFor="password"
            >
              Password
            </label>

            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {/* Create account button */}
          <button
            className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            type="submit"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>

        </form>

        {/* Registration success/error message */}
        {message && (
          <p
            className="mt-4 text-center text-sm text-gray-600"
            role="status"
          >
            {message}
          </p>
        )}

        {/* Link back to login page */}
        <p className="mt-6 text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link
            className="text-blue-600 hover:underline"
            href="/login"
          >
            Log in
          </Link>
        </p>

      </section>
    </main>
  );
}