
const devId = process.env.BONANZA_DEV_ID;
const certId = process.env.BONANZA_CERT_ID;
const token = process.env.BONANZA_USER_TOKEN;

const itemId = "1820613938";

if (!devId || !certId || !token) {
  console.error("Missing Bonanza credentials.");
  process.exit(1);
}

try {
  const body = new URLSearchParams({
    getUnlistedItemRequest: JSON.stringify({
      requesterCredentials: {
        bonanzleAuthToken: token,
      },
      itemId,
    }),
  });

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

  const data = await response.json();

  if (!response.ok || data.ack !== "Success") {
    console.error("HTTP status:", response.status);
    console.error("Bonanza error:", data.errorMessage ?? data.ack);
    process.exitCode = 1;
  } else {
    const item = data.getUnlistedItemResponse?.item;

    if (!item) {
      console.log("Unexpected response:", Object.keys(data));
    } else {
      console.log("Item ID:", item.itemID);
      console.log("Title:", item.title);
      console.log("Status:", item.listingStatus);
      console.log("Quantity:", item.quantity);
      console.log("SKU:", item.sku);
      console.log("Category:", item.primaryCategory?.categoryId);
    }
  }
} catch (error) {
  console.error("Request failed:", error.message);
  process.exitCode = 1;
}
