
const devId = process.env.BONANZA_DEV_ID;
const parentId = Number(process.argv[2] ?? 0);

if (!devId || !Number.isInteger(parentId) || parentId < 0) {
  console.error("Invalid Developer ID or category ID.");
  process.exit(1);
}

try {
  const body = new URLSearchParams({
    getCategoriesRequest: JSON.stringify({
      categoryParent: parentId,
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
    console.error("Category request failed.");
    console.error(data.errorMessage ?? data.ack);
    process.exitCode = 1;
  } else {
    const categories =
      data.getCategoriesResponse?.categoryArray ?? [];

    for (const category of categories) {
      console.log(
        `${category.categoryId} | ${category.categoryName}` +
        `${category.leafCategory ? " [Final category]" : ""}`
      );
    }

    console.log(`\nFound ${categories.length} categories.`);
  }
} catch (error) {
  console.error("Request failed:", error.message);
  process.exitCode = 1;
}
