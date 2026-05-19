// Anthropic API proxy for the fuel route planner.
// Holds the API key server-side so the client can't see it, and forwards
// the request body straight to Anthropic. The client sends the same
// payload it would send directly to api.anthropic.com.

export const config = {
  // Allow the proxy to wait up to 60 seconds for web search to complete.
  // Vercel Hobby tier caps at 10s; Pro is 60s; Enterprise is 900s.
  maxDuration: 60,
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({
      error: { type: "method_not_allowed", message: "Use POST." },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: {
        type: "configuration_error",
        message:
          "Server is missing ANTHROPIC_API_KEY. Set it in your hosting environment.",
      },
    });
  }

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    // Forward the status and body unchanged so client error handling works.
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("plan-route proxy error:", err);
    return res.status(502).json({
      error: {
        type: "proxy_error",
        message: err.message || "Failed to reach the Anthropic API.",
      },
    });
  }
}
