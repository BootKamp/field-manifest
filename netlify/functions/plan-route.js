// netlify/functions/plan-route.js
// Netlify Function that proxies requests to the Anthropic API.
// Accessible at /.netlify/functions/plan-route
// Set ANTHROPIC_API_KEY in Netlify's environment variables.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

exports.handler = async (event, context) => {
  // Only POST allowed
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({
        error: { type: "method_not_allowed", message: "Use POST." },
      }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: {
          type: "configuration_error",
          message:
            "Server is missing ANTHROPIC_API_KEY. Set it in Netlify's environment variables.",
        },
      }),
    };
  }

  try {
    const requestBody = JSON.parse(event.body);

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("plan-route function error:", err);
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: {
          type: "proxy_error",
          message: err.message || "Failed to reach the Anthropic API.",
        },
      }),
    };
  }
};
