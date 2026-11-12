
const devId = process.env.BONANZA_DEV_ID;
const categoryId = 83889;

if (!devId) {
  console.error("Missing Bonanza Developer ID.");
  process.exit(1);
}

try {
  const body = new URLSearchParams({
    getCategoryTraitsRequest: JSON.stringify({
      categoryId,
    }),
  });

  const response = await fetch(
    "https://api.bonanza.com/api_requests/standard_request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-BONANZLE-API-DEV-NAME": devId,
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
    const traits = data.getCategoryTraitsResponse?.traitArray ?? [];

    console.log("Category ID:", categoryId);
    console.log("Available traits:", traits.length);

    for (const trait of traits) {
      console.log("-------------------------");
      console.log("Name:", trait.label);
      console.log("Input:", trait.htmlInputType);
      console.log("Seller input requested:", trait.requestSellerInput);

      const values = trait.traitValues ?? [];
      for (const value of Array.isArray(values) ? values : [values]) {
        console.log("  Option:", value.name);
      }
    }
  }
} catch (error) {
  console.error("Request failed:", error.message);
  process.exitCode = 1;
}
