export type ProductionEbayLocation = {
  merchantLocationKey: string;
  name: string;
};

export async function getProductionEbayLocations(
  accessToken: string,
  apiBase = "https://api.ebay.com"
): Promise<ProductionEbayLocation[]> {
  const locations: ProductionEbayLocation[] = [];
  let offset = 0;
  let total = 0;

  do {
    const response = await fetch(
      `${apiBase}/sell/inventory/v1/location?limit=100&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      console.error("eBay inventory location list failed:", {
        status: response.status,
      });
      throw new Error("Could not retrieve eBay inventory locations.");
    }

    const data: {
      locations?: Array<{
        merchantLocationKey?: string;
        merchantLocationStatus?: string;
        name?: string;
      }>;
      total?: number;
    } = await response.json();

    total = data.total ?? 0;
    for (const location of data.locations ?? []) {
      if (
        location.merchantLocationStatus === "ENABLED" &&
        location.merchantLocationKey
      ) {
        locations.push({
          merchantLocationKey: location.merchantLocationKey,
          name: location.name ?? location.merchantLocationKey,
        });
      }
    }

    offset += (data.locations ?? []).length;
    if (!data.locations?.length) {
      break;
    }
  } while (offset < total);

  return locations;
}
