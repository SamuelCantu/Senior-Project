import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const errorDescription =
    request.nextUrl.searchParams.get("error_description");

  const returnedState = request.nextUrl.searchParams.get("state");
  const savedState = request.cookies.get("ebay_oauth_state")?.value;

  /*
   * STEP 1:
   * Verify the OAuth state value.
   *
   * This helps make sure the callback belongs to the OAuth
   * request that originally started from ListNexus.
   */
  if (!returnedState || !savedState || returnedState !== savedState) {
    return NextResponse.json(
      {
        error: "Invalid OAuth state.",
      },
      { status: 400 }
    );
  }

  /*
   * STEP 2:
   * Handle an error returned by eBay.
   */
  if (error) {
    return NextResponse.json(
      {
        error,
        error_description: errorDescription,
      },
      { status: 400 }
    );
  }

  /*
   * STEP 3:
   * Make sure eBay returned an authorization code.
   */
  if (!code) {
    return NextResponse.json(
      {
        error: "No authorization code received from eBay.",
      },
      { status: 400 }
    );
  }

  /*
   * STEP 4:
   * Make sure the required eBay environment variables exist.
   */
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const redirectUri = process.env.EBAY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error: "Missing eBay configuration.",
      },
      { status: 500 }
    );
  }

  /*
   * STEP 5:
   * Find the currently logged-in ListNexus user.
   *
   * We use the normal Supabase server client here because
   * it reads the user's authentication session from cookies.
   */
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        error:
          "You must be logged into ListNexus before connecting an eBay account.",
      },
      { status: 401 }
    );
  }

  /*
   * STEP 6:
   * Build the Basic Authentication value required by
   * eBay's OAuth token endpoint.
   */
  const basicAuth = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  try {
    /*
     * STEP 7:
     * Exchange eBay's temporary authorization code
     * for an access token and refresh token.
     */
    const tokenResponse = await fetch(
      "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },

        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }).toString(),
      }
    );

    const tokenData = await tokenResponse.json();

    /*
     * STEP 8:
     * Stop if eBay rejected the authorization code.
     */
    if (!tokenResponse.ok) {
      console.error("eBay token exchange failed:", tokenData);

      return NextResponse.json(
        {
          error: "Failed to exchange eBay authorization code.",
          details: tokenData,
        },
        { status: tokenResponse.status }
      );
    }

    /*
     * We require both tokens because ListNexus needs the
     * refresh token to reconnect automatically after the
     * short-lived access token expires.
     */
    if (
      !tokenData.access_token ||
      !tokenData.refresh_token ||
      !tokenData.expires_in
    ) {
      console.error("Incomplete eBay token response:", tokenData);

      return NextResponse.json(
        {
          error: "eBay returned an incomplete OAuth token response.",
        },
        { status: 500 }
      );
    }

    /*
     * STEP 9:
     * Convert the expiration durations returned by eBay
     * into actual timestamps that we can store in Supabase.
     */
    const accessTokenExpiresAt = new Date(
      Date.now() + tokenData.expires_in * 1000
    ).toISOString();

    const refreshTokenExpiresAt =
      tokenData.refresh_token_expires_in
        ? new Date(
            Date.now() +
              tokenData.refresh_token_expires_in * 1000
          ).toISOString()
        : null;

    /*
     * STEP 10:
     * Create our trusted server-only Supabase client.
     *
     * This client uses SUPABASE_SECRET_KEY and therefore
     * must NEVER be used in a browser component.
     */
    const admin = createAdminClient();

    /*
     * STEP 11:
     * Save the marketplace connection.
     *
     * UPSERT means:
     *
     * - If this user has never connected eBay, create a row.
     * - If they reconnect later, replace the old tokens.
     */
    const { error: databaseError } = await admin
      .from("marketplace_accounts")
      .upsert(
        {
          user_id: user.id,

          marketplace: "EBAY",

          environment: "SANDBOX",

          access_token: tokenData.access_token,

          refresh_token: tokenData.refresh_token,

          access_token_expires_at:
            accessTokenExpiresAt,

          refresh_token_expires_at:
            refreshTokenExpiresAt,

          token_type:
            tokenData.token_type ?? "User Access Token",

          scope: EBAY_SCOPES,

          connected_at: new Date().toISOString(),

          updated_at: new Date().toISOString(),
        },
        {
          onConflict:
            "user_id,marketplace,environment",
        }
      );

    /*
     * STEP 12:
     * Stop if Supabase could not save the account.
     */
    if (databaseError) {
      console.error(
        "Failed to save eBay connection:",
        databaseError
      );

      return NextResponse.json(
        {
          error:
            "eBay authorization succeeded, but ListNexus could not save the marketplace connection.",
        },
        { status: 500 }
      );
    }

    /*
     * STEP 13:
     * Redirect to our success page.
     */
    const response = NextResponse.redirect(
      new URL("/ebay-success", request.url)
    );

    /*
     * The OAuth state is single-use, so remove it now.
     */
    response.cookies.delete("ebay_oauth_state");

    return response;
  } catch (err) {
    console.error(
      "eBay OAuth callback error:",
      err
    );

    return NextResponse.json(
      {
        error:
          "Internal server error during eBay authorization.",
      },
      { status: 500 }
    );
  }
}