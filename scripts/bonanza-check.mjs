
const devId = process.env.BONANZA_DEV_ID;
const certId = process.env.BONANZA_CERT_ID;
const token = process.env.BONANZA_USER_TOKEN;

if (!devId || !certId || !token) {
  console.error("Missing Bonanza credentials or user token.");
  process.exit(1);
}

try {
  const response = await fetch(
    "https://api.bonanza.com/api_requests/secure_request",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-BONANZLE-API-DEV-NAME": devId,
        "X-BONANZLE-API-CERT-NAME": certId,
      },
      body: JSON.stringify({
        getTokenStatusRequest: {
          requesterCredentials: {
            bonanzleAuthToken: token,
          },
        },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok || data.ack !== "Success") {
    console.error(
      "Bonanza could not check the token.",
      "HTTP status:",
      response.status
    );
    process.exitCode = 1;
  } else {
    const status = data.getTokenStatusResponse;

    console.log("API response:", data.ack);
    console.log("Verified value:", status?.verified);
    console.log("Verified type:", typeof status?.verified);
    console.log("Expiration:", status?.hardExpirationTime);

    if (status?.verified === true || status?.verified === "true") {
      console.log("SUCCESS! Bonanza seller authorized!");
      console.log("Expires:", status.hardExpirationTime);
    } else {
      console.log("Token not verified yet.");
      console.log("Open your authorization URL and approve access.");
    }
  }
} catch (error) {
  console.error("Connection failed:", error.message);
  process.exitCode = 1;
}
