import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // One workflow on one page: the old agent page now lives at the home page.
  async redirects() {
    return [{ source: "/agent", destination: "/", permanent: false }];
  },
  // Export reads its fonts from disk at runtime, so they must ship with that route's serverless function.
  outputFileTracingIncludes: {
    "/api/agent/export": ["./assets/fonts/**/*"],
  },
  // Security headers on every response (SEC-WEB-02, SEC-DATA-01). The page CSP is set per request in src/proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
