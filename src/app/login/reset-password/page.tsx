"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUpdatePassword(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      console.error("Update password error:", error);
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/login");
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-20 text-gray-900">
      <section className="mx-auto max-w-md">
        <h1 className="mb-4 text-center text-3xl font-bold text-blue-600">
          ListNexus
        </h1>

        <h2 className="mb-3 text-center text-2xl font-semibold">
          Choose a new password
        </h2>

        <p className="mb-8 text-center text-gray-600">
          Enter a new password for your ListNexus account.
        </p>

        <form
          onSubmit={handleUpdatePassword}
          className="space-y-5"
        >
          <div>
            <label
              className="mb-2 block font-medium"
              htmlFor="password"
            >
              New Password
            </label>

            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              className="w-full rounded-lg border px-4 py-3"
              placeholder="Enter new password"
            />
          </div>

          <div>
            <label
              className="mb-2 block font-medium"
              htmlFor="confirmPassword"
            >
              Confirm Password
            </label>

            <input
              id="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              className="w-full rounded-lg border px-4 py-3"
              placeholder="Enter password again"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading
              ? "Updating..."
              : "Update Password"}
          </button>
        </form>
      </section>
    </main>
  );
}