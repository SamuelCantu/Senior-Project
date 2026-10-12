"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function RegisterPage() {
  const [message, setMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Account registration is not connected yet.");
  }

  /* Registration form goes here btw*/
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>
        <h2 className="mb-3 text-center text-2xl font-semibold">Create an account</h2>

    
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="name">
              Name
            </label>
            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              id="name"
              name="name"
              autoComplete="name"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>

          <button
            className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            type="submit"
          >
            Create account
          </button>
            
        </form>

        {message && (
          <p className="mt-4 text-center text-sm text-gray-600" role="status">
            {message}
          </p>
        )}

        <p className="mt-6 text-center text-sm text-gray-600">
          Already have an account?{" "}
          <Link className="text-blue-600 hover:underline" href="/login">
            Log in
          </Link>
        </p>
      </section>
    </main>
  );
}