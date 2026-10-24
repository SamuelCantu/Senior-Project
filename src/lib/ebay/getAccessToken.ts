import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns a valid eBay Sandbox access token for a ListNexus user.
 *
 * If the stored access token has expired, this function automatically
 * uses the user's refresh token to obtain a new access token from eBay
 * and saves the new token back into Supabase.
 */
export async function getEbayAccessToken(
  userId: string
): Promise<string> {
  const admin = createAdminClient();

  /*
   * STEP 1:
   * Get this user's connected eBay Sandbox account.
   */
  const { data: account, error: accountError } = await admin
    .from("marketplace_accounts")
    .select(
      `
        id,
        access_token,
        refresh_token,
        access_token_expires_at,
        refresh_token_expires_at
      `
    )
    .eq("user_id", userId)
    .eq("marketplace", "EBAY")
    .eq("environment", "SANDBOX")
    .single();

  if (accountError || !account) {
    throw new Error(
      "No eBay Sandbox account is connected to this ListNexus user."
    );
  }

  /*
   * STEP 2:
   * Check whether the current access token is still valid.
   */
  const accessTokenExpiresAt = new Date(
    account.access_token_expires_at
  ).getTime();

  if (accessTokenExpiresAt > Date.now()) {
    return account.access_token;
  }

  /*
   * STEP 3:
   * Make sure the refresh token itself has not expired.
   */
  if (account.refresh_token_expires_at) {
    const refreshTokenExpiresAt = new Date(
      account.refresh_token_expires_at
    ).getTime();

    if (refreshTokenExpiresAt <= Date.now()) {
      throw new Error(
        "The eBay refresh token has expired. Please reconnect your eBay account."
      );
    }
  }

  /*
   * STEP 4:
   * Load the eBay application credentials.
   */
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing eBay Client ID or Client Secret."
    );
  }

  /*
   * eBay requires:
   *
   * Authorization: Basic base64(client_id:client_secret)
   */
  const basicAuth = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  /*
   * STEP 5:
   * Exchange the refresh token for a new access token.
   */
  const tokenResponse = await fetch(
    "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",

        Authorization: `Basic ${basicAuth}`,
      },

      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }).toString(),
    }
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error(
      "eBay refresh-token request failed:",
      tokenData
    );

    throw new Error(
      "Unable to refresh the eBay access token. Please reconnect your eBay account."
    );
  }

  if (!tokenData.access_token || !tokenData.expires_in) {
    throw new Error(
      "eBay returned an incomplete refresh-token response."
    );
  }

  /*
   * STEP 6:
   * Calculate when the new access token expires.
   */
  const newAccessTokenExpiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000
  ).toISOString();

  /*
   * STEP 7:
   * Save the new access token in Supabase.
   *
   * We intentionally KEEP the existing refresh token.
   * eBay normally does not return a new refresh token
   * during this request.
   */
  const { error: updateError } = await admin
    .from("marketplace_accounts")
    .update({
      access_token: tokenData.access_token,

      access_token_expires_at:
        newAccessTokenExpiresAt,

      token_type:
        tokenData.token_type ?? "User Access Token",

      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  if (updateError) {
    console.error(
      "Failed to save refreshed eBay token:",
      updateError
    );

    throw new Error(
      "The eBay token was refreshed, but ListNexus could not save it."
    );
  }

  /*
   * STEP 8:
   * Return the new access token.
   */
  return tokenData.access_token;
}