"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function EbaySuccessPage() {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function checkAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setCheckingAuth(false);
    }

    checkAuth();
  }, [router]);

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </main>
    );
  }
  
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg text-center">
        <h1 className="mb-4 text-3xl font-bold">
          eBay Connected!
        </h1>

        <p className="mb-6">
          ListNexus successfully connected to your eBay Sandbox account.
        </p>

        {/* Creates a test inventory item in eBay Sandbox */}
        <form
          action="/api/ebay/create-test-item"
          method="POST"
          className="mb-4"
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-black px-5 py-3 text-white"
          >
            Create Test eBay Item
          </button>
        </form>

        {/* Syncs the user's centralized ListNexus location to eBay */}
        <form
          action="/api/ebay/sync-location"
          method="POST"
          className="mb-4"
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-black px-5 py-3 text-white"
          >
            Sync ListNexus Location to eBay
          </button>
        </form>

        {/* Enables eBay Selling Policy Management */}
        <form
          action="/api/ebay/opt-in-policies"
          method="POST"
          className="mb-4"
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-black px-5 py-3 text-white"
          >
            Enable eBay Business Policies
          </button>
        </form>

        {/* Syncs centralized ListNexus policies to eBay */}
        <form
          action="/api/ebay/sync-policies"
          method="POST"
          className="mb-4"
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-black px-5 py-3 text-white"
          >
            Sync ListNexus Policies to eBay
          </button>
        </form>

        <Link
          href="/"
          className="inline-block w-full rounded-lg border px-5 py-3"
        >
          Return Home
        </Link>
      </div>
    </main>
  );
}