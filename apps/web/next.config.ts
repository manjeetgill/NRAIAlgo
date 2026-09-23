import type { NextConfig } from "next";
import { resolve } from "node:path";

// Proxies browser calls to the Fastify API so the frontend never needs CORS
// and the browser only ever talks to its own origin. API_INTERNAL_URL lets a
// real deployment point this at wherever the API actually runs; the default
// only makes sense for local dev, where apps/api listens on port 4000.
const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${apiInternalUrl}/v1/:path*` }];
  },
};

export default nextConfig;
