import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Cache app shell aggressively so it works offline after first visit.
  // The fuel planner needs network, but the packing list, payload tracker,
  // journal, and blueprints work fully offline once the app is loaded once.
  runtimeCaching: [
    {
      urlPattern: /^https?.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "field-manifest-runtime",
        expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 * 30 },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default withPWA(nextConfig);
