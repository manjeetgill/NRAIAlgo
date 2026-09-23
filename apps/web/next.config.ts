import type { NextConfig } from "next";

// Proxies browser calls to the Fastify API so the frontend never needs CORS
// and the browser only ever talks to its own origin. API_INTERNAL_URL lets a
// real deployment point this at wherever the API actually runs; the default
// only makes sense for local dev, where apps/api listens on port 4000.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${apiInternalUrl}/v1/:path*` }];
  },
};

export default nextConfig;
