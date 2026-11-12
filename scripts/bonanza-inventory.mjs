
const devId = process.env.BONANZA_DEV_ID;
const certId = process.env.BONANZA_CERT_ID;
const token = process.env.BONANZA_USER_TOKEN;

if (!devId || !certId || !token) {
  console.error("Missing Bonanza credentials.");
  process.exit(1);
}

async function testInventory() {
  const args = {
    boothId: "bluemustangjosh",
    requesterCredentials: {
      bonanzleAuthToken: token,
    },
    itemsPerPage: 10,
    page: 1,
  };

  const body = new URLSearchParams({
    getBoothItemsRequest: JSON.stringify(args),
  });

  try {
    console.log("Requesting Bonanza inventory...");

    const response = await fetch(
      "https://api.bonanza.com/api_requests/secure_request",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-BONANZLE-API-DEV-NAME": devId,
          "X-BONANZLE-API-CERT-NAME": certId,
        },
        body: body.toString(),
      }
    );

    console.log("HTTP status:", response.status);
    console.log(
      "Response type:",
      response.headers.get("content-type")
    );

    const raw = await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      console.error("Bonanza returned a non-JSON response.");
      console.log("Response length:", raw.length);
      return;
    }

    console.log("API acknowledgment:", data.ack);

    if (!response.ok || data.ack !== "Success") {
      console.log(
        "Bonanza error:",
        JSON.stringify(data.errorMessage ?? null)
      );
      return;
    }

    const inventory = data.getBoothItemsResponse;

    if (!inventory) {
      console.log(
        "Unexpected response fields:",
        Object.keys(data)
      );
      return;
    }

    console.log(
      "Total listings:",
      inventory.totalEntries ?? 0
    );

    const items = inventory.items ?? [];

    for (const item of Array.isArray(items) ? items : [items]) {
      if (!item) continue;

      console.log("-------------------");
      console.log("Title:", item.title);
      console.log("Price:", item.currentPrice);
      console.log("Quantity:", item.quantity);
    }

    console.log("Inventory test complete!");
  } catch (error) {
    console.error("Connection error:", error.message);
  }
}

testInventory();
