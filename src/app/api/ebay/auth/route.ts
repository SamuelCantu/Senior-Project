import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const redirectUri = process.env.EBAY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Missing eBay configuration" },
      { status: 500 }
    );
  }

  // Random value used to protect the OAuth request.
  const state = crypto.randomBytes(32).toString("hex");

  const authUrl = new URL(
    "https://auth.sandbox.ebay.com/oauth2/authorize"
  );

  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  /*
   * Permissions ListNexus currently needs:
   *
   * Base scope       -> general eBay API access
   * sell.inventory   -> inventory items and offers
   * sell.fulfillment -> orders / fulfillment
   * sell.account     -> business policies and seller account settings
   */
  authUrl.searchParams.set(
    "scope",
    [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      "https://api.ebay.com/oauth/api_scope/sell.account",
    ].join(" ")
  );

  const response = NextResponse.redirect(authUrl.toString());

  response.cookies.set("ebay_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}