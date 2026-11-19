"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";

const EBAY_OAUTH_MESSAGES = {
  connected: "Your eBay Production account is connected.",
  denied: "eBay authorization was declined. You can try again.",
  "invalid-state": "The authorization session expired or could not be verified. Please try again.",
  "transaction-check-failed": "Could not verify the eBay authorization session. Please try again.",
  "missing-code": "eBay did not return an authorization code. Please try again.",
  "configuration-missing": "eBay Production connection is not configured correctly. Please contact support.",
  "token-exchange-failed": "eBay could not complete authorization. Please try again.",
  "invalid-token-response": "eBay returned an invalid authorization response. Please try again.",
  "connection-check-failed": "Could not verify the existing eBay connection.",
  "save-failed": "Authorization succeeded, but ListNexus could not save the connection.",
  "connection-failed": "Could not complete the eBay connection. Please try again.",
  "login-required": "Please sign in again before connecting eBay.",
  "start-failed": "Could not start eBay authorization. Please try again.",
  "popup-cancelled": "eBay authorization was canceled. Your account is still disconnected. You can try again whenever you’re ready.",
} as const;

type EbayOAuthResult = keyof typeof EBAY_OAUTH_MESSAGES;

function isEbayOAuthResult(value: unknown): value is EbayOAuthResult {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(EBAY_OAUTH_MESSAGES, value);
}

const EBAY_POPUP_MESSAGE_TYPE = "listnexus:ebay-production-oauth-complete";

export default function SettingsPage() {
  const router = useRouter();

  const [displayName, setDisplayName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [email, setEmail] = useState("");
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [message, setMessage] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [ebayConnected, setEbayConnected] = useState<boolean | null>(null);
  const [ebayStatusError, setEbayStatusError] = useState("");
  const [ebayResult, setEbayResult] = useState("");

  const refreshEbayStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/ebay/production/status", {
        cache: "no-store",
      });
      if (!response.ok) {
        setEbayStatusError("Could not load eBay connection status.");
        return null;
      }
      const status: { connected: boolean } = await response.json();
      setEbayStatusError("");
      setEbayConnected(status.connected);
      return status.connected;
    } catch {
      setEbayStatusError("Could not load eBay connection status.");
      return null;
    }
  }, []);

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

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("ebay");
    if (isEbayOAuthResult(result)) setEbayResult(EBAY_OAUTH_MESSAGES[result]);
    void refreshEbayStatus();
  }, [refreshEbayStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("popup") !== "1") return;

    const rawResult = params.get("ebay");
    const result = isEbayOAuthResult(rawResult) ? rawResult : "connection-failed";
    window.history.replaceState(window.history.state, "", "/settings");

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: EBAY_POPUP_MESSAGE_TYPE, result },
        window.location.origin
      );
    }
    window.close();
  }, []);

  function handleEbayConnection() {
    setEbayResult("");
    const popup = window.open(
      "about:blank",
      "listnexusEbayOAuth",
      "popup,width=640,height=760,resizable=yes,scrollbars=yes"
    );

    if (!popup) {
      window.location.assign("/api/ebay/production/auth");
      return;
    }

    let completed = false;
    let popupWatch: number | null = null;
    const stopWatching = () => {
      if (popupWatch !== null) window.clearInterval(popupWatch);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source !== popup) return;
      if (!event.data || typeof event.data !== "object") return;

      const data = event.data as { type?: unknown; result?: unknown };
      if (data.type !== EBAY_POPUP_MESSAGE_TYPE || !isEbayOAuthResult(data.result)) return;

      completed = true;
      stopWatching();
      setEbayResult(EBAY_OAUTH_MESSAGES[data.result]);
      popup.close();
      void refreshEbayStatus();
    };

    window.addEventListener("message", onMessage);
    popupWatch = window.setInterval(() => {
      if (!popup.closed) return;
      if (popupWatch !== null) window.clearInterval(popupWatch);
      popupWatch = null;

      window.setTimeout(() => {
        if (completed) return;
        window.removeEventListener("message", onMessage);
        void refreshEbayStatus().then((connected) => {
          if (connected) {
            setEbayResult(EBAY_OAUTH_MESSAGES.connected);
          } else {
            setEbayResult(EBAY_OAUTH_MESSAGES["popup-cancelled"]);
          }
        });
      }, 1000);
    }, 500);

    popup.location.href = "/api/ebay/production/auth?popup=1";
  }

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "dark") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    } else {
      setDarkMode(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

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

  function handleDarkMode(enabled: boolean) {
    setDarkMode(enabled);

    if (enabled) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }

  if (checkingAuth) {
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
            <AuthNav />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Settings</h1>

        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage your ListNexus account settings.
        </p>

        <section className="mt-8 rounded-xl border bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
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
                className="flex-1 rounded-lg border px-4 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
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
              className="w-full rounded-lg border bg-gray-100 px-4 py-2 text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
            />
          </div>

          {message && (
            <p className="mt-4 text-sm text-green-700 dark:text-green-300">
              {message}
            </p>
          )}
        </section>

        <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-xl font-semibold">
            Connected Marketplaces
          </h2>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Connect marketplace accounts to publish and manage listings through ListNexus.
          </p>

          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-4 dark:border-gray-700">
              <div>
                <p className="font-semibold">
                  eBay
                </p>

                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {ebayConnected === null
                    ? "Checking eBay connection..."
                    : ebayConnected
                      ? "Your eBay Production account is connected."
                      : "Connect your eBay seller account to ListNexus."}
                </p>
                {ebayStatusError && (
                  <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
                    {ebayStatusError}
                  </p>
                )}
                {ebayResult && (
                  <p
                    role="status"
                    className={`mt-1 text-sm ${ebayResult.startsWith("Your eBay") ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"}`}
                  >
                    {ebayResult}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleEbayConnection}
                className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                {ebayConnected ? "Reconnect eBay" : "Connect eBay"}
              </button>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4 dark:border-gray-700">
              <div>
                <p className="font-semibold">
                  Bonanza
                </p>

                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Marketplace integration is being developed.
                </p>
              </div>

              <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-semibold text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300">
                Coming Soon
              </span>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-xl font-semibold">Security</h2>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            ListNexus uses secure authentication and does not store marketplace
            passwords. Marketplace accounts are connected through authorized
            account access.
          </p>

          <Link
            href="/login/forgot-password"
            className="mt-4 inline-block text-blue-600 hover:underline"
          >
            Change Password
          </Link>
        </section>

        <section className="mt-6 rounded-xl border bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-xl font-semibold dark:text-gray-100">
            Appearance
          </h2>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="font-medium dark:text-gray-100">
                Dark Mode
              </p>

              <p className="text-sm text-gray-600 dark:text-gray-400">
                Use a darker theme for ListNexus.
              </p>
            </div>

            <input
              type="checkbox"
              checked={darkMode}
              onChange={(event) =>
                handleDarkMode(event.target.checked)
              }
              className="h-5 w-5"
            />
          </div>
        </section>
      </div>
    </main>
  );
}