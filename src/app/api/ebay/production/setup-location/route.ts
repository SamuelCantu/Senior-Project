import { createClient } from "@/lib/supabase/server";
import { getProductionEbayAccessToken } from "@/lib/ebay/getProductionAccessToken";
import { getProductionEbayLocations } from "@/lib/ebay/productionLocations";

export const runtime = "nodejs";
const EBAY_API_BASE = "https://api.ebay.com";

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error ? null : user;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return Response.json({ error: "You must be logged into ListNexus." }, { status: 401 });
  }

  try {
    const token = await getProductionEbayAccessToken(user.id);
    const locations = await getProductionEbayLocations(token);
    return Response.json({ locations });
  } catch (error) {
    console.error("Production eBay location retrieval failed:", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: "Could not retrieve enabled eBay Production locations." },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return Response.json({ error: "You must be logged into ListNexus." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Enter your real shipping-origin information." }, { status: 400 });
  }

  const fields = ["name", "addressLine1", "city", "stateOrProvince", "postalCode", "country"] as const;
  const values = Object.fromEntries(
    fields.map((field) => [field, typeof body[field] === "string" ? body[field].trim() : ""])
  ) as Record<(typeof fields)[number], string>;
  if (fields.some((field) => !values[field])) {
    return Response.json(
      { error: "Enter the location name and your real shipping-origin street, city, state/region, postal code, and country." },
      { status: 400 }
    );
  }

  const merchantLocationKey = `LN${crypto.randomUUID().replace(/-/g, "").slice(0, 30)}`;
  const token = await getProductionEbayAccessToken(user.id);
  const response = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        location: {
          address: {
            addressLine1: values.addressLine1,
            city: values.city,
            stateOrProvince: values.stateOrProvince,
            postalCode: values.postalCode,
            country: values.country.toUpperCase(),
          },
        },
        name: values.name,
        merchantLocationStatus: "ENABLED",
        locationTypes: ["WAREHOUSE"],
      }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    console.error("eBay Production location creation failed:", { status: response.status });
    return Response.json(
      { error: "eBay could not create the location. Verify the shipping-origin details and try again." },
      { status: response.status }
    );
  }

  return Response.json({ location: { merchantLocationKey, name: values.name } });
}
