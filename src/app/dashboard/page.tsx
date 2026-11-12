"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";
import { useRouter } from "next/navigation";


export default function DashboardPage() {
  const [displayName, setDisplayName] = useState("");
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  //For dashboard overview stats
  const [activeListings, setActiveListings] = useState(0);
  const [drafts, setDrafts] = useState(0);
  const [inventoryItems, setInventoryItems] = useState(0);
  const overview = [
    { label: "Active listings", value: activeListings.toString() },
    { label: "Drafts", value: drafts.toString() },
    { label: "Inventory items", value: inventoryItems.toString() },
  ];    
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
      // Fetch counts for products and drafts
      const [
        { count: productCount, error: productCountError },
        { count: draftCount, error: draftCountError },
      ] = await Promise.all([
        supabase
          .from("products")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id),

        supabase
          .from("listing_drafts")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id),
      ]);

      if (productCountError) {
        console.error("Could not count inventory items:", productCountError);
      }

      if (draftCountError) {
        console.error("Could not count listing drafts:", draftCountError);
      }

      setInventoryItems(productCount ?? 0);
      setDrafts(draftCount ?? 0);

      const {
        data: userProducts,
        error: userProductsError,
      } = await supabase
        .from("products")
        .select("id")
        .eq("user_id", user.id);

      if (userProductsError) {
        console.error(
          "Could not load products for active listing count:",
          userProductsError
        );
      } else {
        const productIds = (userProducts ?? []).map(
          (product) => product.id
        );

        if (productIds.length > 0) {
          const {
            count: activeCount,
            error: activeCountError,
          } = await supabase
            .from("marketplace_listings")
            .select("*", { count: "exact", head: true })
            .in("product_id", productIds)
            .eq("status", "ACTIVE");

          if (activeCountError) {
            console.error(
              "Could not count active listings:",
              activeCountError
            );
          } else {
            setActiveListings(activeCount ?? 0);
          }
        }
      }

      const savedName = 
        user.user_metadata?.display_name ?? 
        user.user_metadata?.full_name??
        "";

      setDisplayName(savedName);
      setCheckingAuth(false);
    }

    loadUser();
  }, []);


  if(checkingAuth) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b bg-white dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="text-xl font-bold text-blue-600" href="/">
            ListNexus
          </Link>
          <nav className="flex items-center gap-5 text-sm font-medium">
            
            <Link className="text-blue-700" href="/settings">
              Settings
            </Link>
            
            <AuthNav showDashboard={false} />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <section className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 text-3xl font-bold">
              <span className="text-blue-600">
                Hello {displayName || "User"},
              </span>
            </div>
            <h1 className="text-3xl font-bold">ListNexus Station</h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Keep track of your listings here!
            </p>
          </div>
        </section>

        <div className="flex gap-8">
          <section className="flex-1 rounded-[14px] border border-[#2e2e2e] bg-[#f5f5f5] p-4 dark:border-gray-700 dark:bg-gray-900">
            <div className="flex min-h-[420px] items-center justify-center text-center">
              <div>
                <h2 className="text-[2.1rem] font-semibold text-black dark:text-gray-100">
                  No listings yet
                </h2>
                <p className="mt-6 text-[1.15rem] italic text-gray-500 dark:text-gray-400">
                  Start with a product and create your first marketplace listing.
                </p>
                <Link
                  className="mt-8 inline-block text-blue-600 underline decoration-blue-600 underline-offset-4"
                  href="/products/new"
                >
                  Create your first listing
                </Link>
              </div>
            </div>
          </section>

          <aside className="w-[340px] space-y-5">
            {overview.map((item) => (
              <div
                key={item.label}
                className="rounded-[14px] border border-[#2e2e2e] bg-[#f8f8f8] p-5 dark:border-gray-700 dark:bg-gray-900"
              >
                <p className="text-sm text-gray-600 dark:text-gray-400">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold">{item.value}</p>
              </div>
            ))}
          </aside>
        </div>

        <div className="mt-8">
          <Link
            href="/products/new"
            className="flex h-[72px] items-center justify-center rounded-lg bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700"
          >
            Create a listing
          </Link>
        </div>
      </div>
    </main>
  );
}