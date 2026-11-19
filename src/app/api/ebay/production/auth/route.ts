import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createProductionOAuthTransaction } from "@/lib/ebay/productionOAuthState";

export const runtime = "nodejs";

const EBAY_AUTH_URL =
  "https://auth.ebay.com/oauth2/authorize";

/*
 * These are the permissions ListNexus currently
 * needs for the eBay seller workflow.
 */
const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];

function settingsRedirect(request: NextRequest, result: string) {
  const url = new URL(`/settings?ebay=${encodeURIComponent(result)}`, request.url);
  url.searchParams.set("popup", "1");
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const isPopup = request.nextUrl.searchParams.get("popup") === "1";

  try {
    /*
     * =====================================================
     * STEP 1
     * MAKE SURE USER IS LOGGED INTO LISTNEXUS
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
      if (isPopup) return settingsRedirect(request, "login-required");
      return NextResponse.redirect(
        new URL(
          "/login",
          process.env
            .NEXT_PUBLIC_SITE_URL ??
            "https://listnexus.vercel.app"
        )
      );
    }

    /*
     * =====================================================
     * STEP 2
     * READ PRODUCTION EBAY CONFIGURATION
     * =====================================================
     */

    const clientId =
      process.env
        .EBAY_PRODUCTION_CLIENT_ID;

    const redirectUri =
      process.env
        .EBAY_PRODUCTION_REDIRECT_URI;

    if (
      !clientId ||
      !redirectUri
    ) {
      if (isPopup) return settingsRedirect(request, "configuration-missing");
      return NextResponse.json(
        {
          error:
            "eBay Production OAuth configuration is incomplete.",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =====================================================
     * STEP 3
     * GENERATE A ONE-TIME CSRF TRANSACTION
     * =====================================================
     *
     * eBay returns this exact value to our callback.
     * We compare it against the HttpOnly cookie before
     * accepting the authorization code.
     */

    const transaction = await createProductionOAuthTransaction(user.id);

    /*
     * =====================================================
     * STEP 4
     * BUILD EBAY PRODUCTION CONSENT URL
     * =====================================================
     */

    const params =
      new URLSearchParams({
        client_id:
          clientId,

        response_type:
          "code",

        /*
         * IMPORTANT:
         * This is the Production RuName.
         */
        redirect_uri:
          redirectUri,

        scope:
          EBAY_SCOPES.join(
            " "
          ),

        state: transaction.state,

        /*
         * Forces the seller login/consent screen.
         */
        prompt:
          "login",
      });

    const ebayUrl =
      `${EBAY_AUTH_URL}?${params.toString()}`;

    /*
     * =====================================================
     * STEP 5
     * SAVE STATE IN SECURE COOKIE
     * =====================================================
     */

    const response =
      NextResponse.redirect(
        ebayUrl
      );

    response.cookies.set("ebay_production_oauth_state", transaction.state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: transaction.maxAge,
    });
    response.cookies.set("ebay_production_oauth_user", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set("ebay_production_oauth_popup", isPopup ? "1" : "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: isPopup ? transaction.maxAge : 0,
    });
    return response;
  } catch (error) {
    console.error("eBay Production OAuth start failed.");

    if (isPopup) return settingsRedirect(request, "start-failed");

    return NextResponse.json(
      {
        error:
          "Could not start eBay Production authorization.",
      },
      {
        status: 500,
      }
    );
  }
}