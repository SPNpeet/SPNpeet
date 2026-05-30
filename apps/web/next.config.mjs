import withPWAInit from "@ducanh2912/next-pwa";

/**
 * PWA / Workbox configuration.
 *
 * Strategy:
 *  - Static assets & the app shell are precached for instant offline boot.
 *  - The product catalog GET (`/api/v1/products`) uses NetworkFirst so the
 *    cashier always gets fresh stock when online but a cached snapshot offline.
 *  - The checkout POST is intentionally NEVER cached — offline sales are queued
 *    in IndexedDB by the app's own sync engine (see src/lib/sync), which is far
 *    more robust than Background Sync for financial transactions.
 */
const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    runtimeCaching: [
      {
        // Catalog snapshot: fresh when possible, cached when offline.
        urlPattern: /\/api\/v1\/products.*$/i,
        handler: "NetworkFirst",
        method: "GET",
        options: {
          cacheName: "spnpeet-catalog",
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern: /^https?.*\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "spnpeet-images",
          expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the lean production Docker image (apps/web/Dockerfile).
  output: "standalone",
  experimental: {
    // zxing ships wasm/esm; keep it server-external-safe.
    esmExternals: true,
  },
};

export default withPWA(nextConfig);
