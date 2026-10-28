import { createAdminClient } from "@/lib/supabase/admin";

type EbayRefreshResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export async function getProductionEbayAccessToken(
  userId: string
) {
  const admin = createAdminClient();

  /*
   * Load ONLY the user's real eBay Production connection.
   * This leaves the Sandbox connection alone.
   */
  const {
    data: account,
    error: accountError,
  } = await admin
    .from("marketplace_accounts")
    .select(`
      id,
      access_token,
      refresh_token,
      access_token_expires_at
    `)
    .eq("user_id", userId)
    .eq("marketplace", "EBAY")
    .eq("environment", "PRODUCTION")
    .single();

  if (accountError || !account) {
    throw new Error(
      "eBay Production is not connected."
    );
  }

  /*
   * If the current access token still has at least
   * one minute remaining, reuse it.
   */
  const expiresAt = new Date(
    account.access_token_expires_at
  ).getTime();

  if (
    expiresAt >
    Date.now() + 60 * 1000
  ) {
    return account.access_token;
  }

  /*
   * Otherwise use the long-lived refresh token
   * to request a fresh Production access token.
   */
  const clientId =
    process.env.EBAY_PRODUCTION_CLIENT_ID;

  const clientSecret =
    process.env.EBAY_PRODUCTION_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing eBay Production credentials."
    );
  }

  if (!account.refresh_token) {
    throw new Error(
      "The eBay Production account does not have a refresh token."
    );
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });

  /*
   * Production token endpoint.
   */
  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",

      headers: {
        Authorization:
          `Basic ${credentials}`,

        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: body.toString(),

      cache: "no-store",
    }
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "eBay Production token refresh failed:",
      response.status,
      errorText
    );

    throw new Error(
      "Could not refresh the eBay Production access token."
    );
  }

  const token =
    (await response.json()) as EbayRefreshResponse;

  if (
    !token.access_token ||
    !token.expires_in
  ) {
    throw new Error(
      "eBay returned an invalid Production access token response."
    );
  }

  /*
   * Calculate the new access-token expiration time.
   */
  const newExpiration =
    new Date(
      Date.now() +
        token.expires_in * 1000
    ).toISOString();

  /*
   * Save the newly refreshed access token.
   *
   * We DO NOT replace the refresh token because eBay's
   * refresh response normally returns only a new access token.
   */
  const {
    error: updateError,
  } = await admin
    .from("marketplace_accounts")
    .update({
      access_token:
        token.access_token,

      access_token_expires_at:
        newExpiration,

      token_type:
        token.token_type ??
        "User Access Token",

      updated_at:
        new Date().toISOString(),
    })
    .eq("id", account.id);

  if (updateError) {
    console.error(
      "Could not save refreshed eBay Production token:",
      updateError
    );

    throw new Error(
      "Could not save the refreshed eBay Production token."
    );
  }

  return token.access_token;
}