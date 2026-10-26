"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthNav() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    async function checkUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setLoggedIn(!!user);
      setLoading(false);
    }

    checkUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session?.user);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();

    await supabase.auth.signOut();

    router.push("/");
    router.refresh();
  }

  if (loading) {
    return null;
  }

  if (loggedIn) {
    return (
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="hover:text-blue-600">
          Dashboard
        </Link>

        <button
          type="button"
          onClick={handleLogout}
          className="hover:text-blue-600"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <Link href="/login" className="hover:text-blue-600">
        Log in
      </Link>

      <Link href="/register" className="hover:text-blue-600">
        Register
      </Link>
    </div>
  );
}