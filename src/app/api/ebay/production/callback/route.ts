import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/*
 * eBay PRODUCTION OAuth token endpoint.
 *
 * IMPORTANT:
 * Sandbox uses api.sandbox.ebay.com.
 * Production uses api.ebay.com.
 */
const EBAY_TOKEN_URL =
  "https://api.ebay.com/identity/v1/oauth2/token";

/*
 * These are the same scopes requested when the
 * seller authorizes ListNexus.
 */
const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];

type EbayTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
};

export async function GET(
  request: NextRequest
) {
  try {
    /*
     * =====================================================
     * STEP 1
     * Make sure the ListNexus user is still logged in.
     * =====================================================
     */

    const supabase =
      await createClient();

    const {
      data: { user },
      error: userError,
    } =
      await supabase.auth.getUser();

    if (
      userError ||
      !user
    ) {
      return NextResponse.redirect(
        new URL(
          "/login?error=ebay-login-required",
          request.url
        )
      );
    }

    /*
     * =====================================================
     * STEP 2
     * Check whether eBay returned an OAuth error.
     * =====================================================
     */

    const ebayError =
      request.nextUrl.searchParams.get(
        "error"
      );

    if (ebayError) {
      console.error(
        "eBay Production authorization error:",
        ebayError
      );

      return NextResponse.redirect(
        new URL(
          "/ai?ebay=declined",
          request.url
        )
      );
    }

    /*
     * =====================================================
     * STEP 3
     * Read the authorization code and state from eBay.
     * =====================================================
     */

    const code =
      request.nextUrl.searchParams.get(
        "code"
      );

    const returnedState =
      request.nextUrl.searchParams.get(
        "state"
      );

    const savedState =
      request.cookies.get(
        "ebay_production_oauth_state"
      )?.value;

    if (!code) {
      return NextResponse.json(
        {
          error:
            "eBay did not return an authorization code.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * The state value protects the OAuth flow
     * from forged callback requests.
     */
    if (
      !returnedState ||
      !savedState ||
      returnedState !== savedState
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid eBay OAuth state. Start the eBay connection from ListNexus again.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * =====================================================
     * STEP 4
     * Load Production credentials.
     * =====================================================
     */

    const clientId =
      process.env
        .EBAY_PRODUCTION_CLIENT_ID;

    const clientSecret =
      process.env
        .EBAY_PRODUCTION_CLIENT_SECRET;

    /*
     * IMPORTANT:
     *
     * This is the eBay RuName, NOT our callback URL.
     */
    const redirectUri =
      process.env
        .EBAY_PRODUCTION_REDIRECT_URI;

    if (
      !clientId ||
      !clientSecret ||
      !redirectUri
    ) {
      return NextResponse.json(
        {
          error:
            "eBay Production OAuth environment variables are incomplete.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * STEP 5
     * Exchange the authorization code for:
     *
     * - Production User Access Token
     * - Production Refresh Token
     * =====================================================
     */

    const basicCredentials =
      Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString("base64");

    const tokenBody =
      new URLSearchParams({
        grant_type:
          "authorization_code",

        code,

        /*
         * eBay expects the Production RuName here.
         */
        redirect_uri:
          redirectUri,
      });

    const tokenResponse =
      await fetch(
        EBAY_TOKEN_URL,
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Basic ${basicCredentials}`,

            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          body:
            tokenBody.toString(),

          cache:
            "no-store",
        }
      );

    if (
      !tokenResponse.ok
    ) {
      const errorText =
        await tokenResponse.text();

      console.error(
        "eBay Production token exchange failed:",
        tokenResponse.status,
        errorText
      );

      return NextResponse.json(
        {
          error:
            "eBay rejected the Production OAuth token exchange.",
        },
        {
          status: 500,
        }
      );
    }

    const tokens =
      (await tokenResponse.json()) as EbayTokenResponse;

    if (
      !tokens.access_token ||
      !tokens.refresh_token ||
      !tokens.expires_in
    ) {
      return NextResponse.json(
        {
          error:
            "eBay returned an incomplete Production token response.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * STEP 6
     * Calculate token expiration times.
     * =====================================================
     */

    const now =
      new Date();

    const accessTokenExpiresAt =
      new Date(
        now.getTime() +
          tokens.expires_in *
            1000
      );

    const refreshTokenExpiresAt =
      tokens.refresh_token_expires_in
        ? new Date(
            now.getTime() +
              tokens.refresh_token_expires_in *
                1000
          )
        : null;

    /*
     * =====================================================
     * STEP 7
     * Store the Production connection.
     *
     * We use the admin Supabase client because these are
     * server-side marketplace credentials and should never
     * be written directly from the browser.
     * =====================================================
     */

    const admin =
      createAdminClient();

    /*
     * Look specifically for:
     *
     * marketplace = EBAY
     * environment = PRODUCTION
     *
     * This leaves the existing Sandbox row alone.
     */
    const {
      data: existingAccount,
      error: lookupError,
    } =
      await admin
        .from(
          "marketplace_accounts"
        )
        .select("id")
        .eq(
          "user_id",
          user.id
        )
        .eq(
          "marketplace",
          "EBAY"
        )
        .eq(
          "environment",
          "PRODUCTION"
        )
        .maybeSingle();

    if (lookupError) {
      console.error(
        "Production marketplace account lookup failed:",
        lookupError
      );

      return NextResponse.json(
        {
          error:
            "Could not check the existing eBay Production connection.",
        },
        {
          status: 500,
        }
      );
    }

    const accountValues = {
      user_id:
        user.id,

      marketplace:
        "EBAY",

      environment:
        "PRODUCTION",

      access_token:
        tokens.access_token,

      refresh_token:
        tokens.refresh_token,

      access_token_expires_at:
        accessTokenExpiresAt.toISOString(),

      refresh_token_expires_at:
        refreshTokenExpiresAt
          ? refreshTokenExpiresAt.toISOString()
          : null,

      token_type:
        tokens.token_type ??
        "User Access Token",

      /*
       * Some eBay responses do not include scope,
       * so fall back to the scopes we requested.
       */
      scope:
        tokens.scope ??
        EBAY_SCOPES.join(
          " "
        ),

      updated_at:
        now.toISOString(),
    };

    /*
     * Update an existing Production connection...
     */
    if (
      existingAccount
    ) {
      const {
        error: updateError,
      } =
        await admin
          .from(
            "marketplace_accounts"
          )
          .update({
            ...accountValues,

            connected_at:
              now.toISOString(),
          })
          .eq(
            "id",
            existingAccount.id
          );

      if (updateError) {
        console.error(
          "Could not update eBay Production account:",
          updateError
        );

        return NextResponse.json(
          {
            error:
              "Could not save the eBay Production connection.",
          },
          {
            status: 500,
          }
        );
      }
    } else {
      /*
       * ...or create a new Production connection.
       */
      const {
        error: insertError,
      } =
        await admin
          .from(
            "marketplace_accounts"
          )
          .insert({
            ...accountValues,

            connected_at:
              now.toISOString(),
          });

      if (insertError) {
        console.error(
          "Could not create eBay Production account:",
          insertError
        );

        return NextResponse.json(
          {
            error:
              "Could not save the eBay Production connection.",
          },
          {
            status: 500,
          }
        );
      }
    }

    /*
     * =====================================================
     * STEP 8
     * Return to ListNexus.
     * =====================================================
     */

    const response =
      NextResponse.redirect(
        new URL(
          "/ai?ebay=production-connected",
          request.url
        )
      );

    /*
     * The OAuth state has served its purpose.
     */
    response.cookies.delete(
      "ebay_production_oauth_state"
    );

    return response;
  } catch (error) {
    console.error(
      "eBay Production callback error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not connect the eBay Production account.",
      },
      {
        status: 500,
      }
    );
  }
}