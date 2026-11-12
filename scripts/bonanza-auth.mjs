
const devId = process.env.BONANZA_DEV_ID;
const certId = process.env.BONANZA_CERT_ID;

if (!devId || !certId) {
  console.error("Missing Bonanza API credentials.");
  process.exit(1);
}

try {
  const response = await fetch(
    "https://api.bonanza.com/api_requests/secure_request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-BONANZLE-API-DEV-NAME": devId,
        "X-BONANZLE-API-CERT-NAME": certId,
      },
      body: "fetchTokenRequest",
    }
  );

  const data = await response.json();

  if (
    !response.ok ||
    data.ack !== "Success" ||
    !data.fetchTokenResponse?.authToken
  ) {
    console.error(
      "Bonanza authorization request failed:",
      data.errorMessage ?? "Unknown error"
    );
    process.exitCode = 1;
  } else {
    console.log("Bonanza authorization token generated!");
    console.log(
      "Authorization URL:",
      data.fetchTokenResponse.authenticationURL
    );
    console.log(
      "User token:",
      data.fetchTokenResponse.authToken
    );
  }
} catch (error) {
  console.error("Unable to connect to Bonanza:", error.message);
  process.exitCode = 1;
}
