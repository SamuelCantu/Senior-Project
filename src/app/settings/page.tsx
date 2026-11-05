"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";

export default function SettingsPage() {
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [email, setEmail] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createClient();

    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const savedName =
        user.user_metadata?.display_name ??
        user.user_metadata?.full_name ??
        "";

      setDisplayName(savedName);
      setNameInput(savedName);
      setEmail(user.email ?? "");
      setCheckingAuth(false);
    }

    loadUser();
  }, [router]);

  async function handleSaveName() {
    const trimmedName = nameInput.trim();

    if (!trimmedName) {
      return;
    }

    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({
      data: {
        display_name: trimmedName,
      },
    });

    if (error) {
      console.error("Failed to update display name:", error);
      setMessage("Could not update display name.");
      return;
    }

    setDisplayName(trimmedName);
    setMessage("Display name updated.");
  }

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="text-xl font-bold text-blue-600" href="/">
            ListNexus
          </Link>

          <nav className="flex items-center gap-5 text-sm font-medium">
            <AuthNav />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Settings</h1>

        <p className="mt-2 text-gray-600">
          Manage your ListNexus account settings.
        </p>

        <section className="mt-8 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Profile</h2>

          <div className="mt-6">
            <label
              htmlFor="displayName"
              className="mb-2 block text-sm font-medium"
            >
              Display Name
            </label>

            <div className="flex gap-2">
              <input
                id="displayName"
                type="text"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                className="flex-1 rounded-lg border px-4 py-2"
              />

              <button
                type="button"
                onClick={handleSaveName}
                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>

          <div className="mt-6">
            <label className="mb-2 block text-sm font-medium">
              Email
            </label>

            <input
              type="email"
              value={email}
              readOnly
              className="w-full rounded-lg border bg-gray-100 px-4 py-2 text-gray-600"
            />
          </div>

          {message && (
            <p className="mt-4 text-sm text-green-700">
              {message}
            </p>
          )}
        </section>

        <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Security</h2>

          <Link
            href="/login/forgot-password"
            className="mt-4 inline-block text-blue-600 hover:underline"
          >
            Change Password
          </Link>
        </section>
      </div>
    </main>
  );
}