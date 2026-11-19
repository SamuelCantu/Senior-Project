import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("marketplace_accounts")
      .select("id,refresh_token")
      .eq("user_id", user.id)
      .eq("marketplace", "EBAY")
      .eq("environment", "PRODUCTION")
      .limit(1);

    if (error) {
      console.error("Could not load eBay Production status:", error.message);
      return NextResponse.json(
        { error: "Could not load eBay connection status." },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { connected: data.some((account) => Boolean(account.refresh_token)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error(
      "eBay Production status error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not load eBay connection status." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
