
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const item = {
  title: "Set of 5 Handmade Pokeball Perler Bead Designs",
  description:
    "Set of five handmade fused Perler bead designs " +
    "featuring Pokeball-inspired patterns in multiple " +
    "color combinations. Includes five individual pieces.",
  sku: "10",
  quantity: 0,
  allowForSale: false,
  obo: false,
  primaryCategory: {
    categoryId: 83889,
  },
  itemSpecifics: {
    specifics: [
      ["Condition", "Used"],
      ["Brand", "Handmade"],
      ["Bundle Listing", "Yes"],
      [
        "Bundle Description",
        "Set of 5 handmade Pokeball-inspired Perler bead designs",
      ],
      ["Handmade", "Yes"],
    ],
  },
};

// Intentionally omit price, shipping and images
// for this first incomplete-item test.

console.log("Bonanza test item:");
console.log(JSON.stringify(item, null, 2));

if (!process.argv.includes("--create-inactive")) {
  console.log("\nDRY RUN ONLY. Nothing was sent to Bonanza.");
  process.exit(0);
}

const rl = readline.createInterface({ input, output });
const confirmation = await rl.question(
  "\nThis will CREATE an incomplete item on Bonanza. Type CREATE to proceed: "
);
rl.close();

if (confirmation !== "CREATE") {
  console.log("Canceled. No item created.");
  process.exit(0);
}

const devId = process.env.BONANZA_DEV_ID;
const certId = process.env.BONANZA_CERT_ID;
const token = process.env.BONANZA_USER_TOKEN;

if (!devId || !certId || !token) {
  throw new Error("Missing Bonanza credentials.");
}

const body = new URLSearchParams({
  addFixedPriceItemRequest: JSON.stringify({
    requesterCredentials: {
      bonanzleAuthToken: token,
    },
    item,
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
  console.error(
    "Bonanza error:",
    JSON.stringify(data.errorMessage ?? data.ack)
  );
  process.exitCode = 1;
} else {
  const result = data.addFixedPriceItemResponse;

  console.log("Item ID:", result?.itemId);
  console.log("Category ID:", result?.categoryId);
  console.log("Selling state:", result?.sellingState);
  console.log("Message:", result?.message ?? "");

  if (result?.sellingState !== "Missing required fields") {
    console.warn(
      "Unexpected selling state! Check the item in Bonanza immediately."
    );
  }
}
