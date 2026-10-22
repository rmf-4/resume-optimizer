import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { buildCsp, proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());

describe("SEC-WEB-01 Content-Security-Policy", () => {
  it("test_csp_header_exact_directives", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = proxy(new NextRequest("http://localhost:3000/"));
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(new RegExp(`script-src 'self' 'nonce-${nonce!.replace(/[+/=]/g, "\\$&")}' 'strict-dynamic'`));
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("test_csp_nonce_is_fresh_per_request", () => {
    const a = buildCsp("abc", false);
    expect(a).toContain("'nonce-abc'");
    const n1 = proxy(new NextRequest("http://localhost:3000/")).headers.get("content-security-policy");
    const n2 = proxy(new NextRequest("http://localhost:3000/")).headers.get("content-security-policy");
    expect(n1).not.toBe(n2);
  });
});

describe("SEC-WEB-02 security headers", () => {
  it("test_security_headers_present", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    const h = Object.fromEntries(all!.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["permissions-policy"]).toContain("microphone=()");
    expect(h["permissions-policy"]).toContain("geolocation=()");
    expect(h["strict-transport-security"]).toMatch(/max-age=\d{8,}; includeSubDomains/);
  });

  it("test_powered_by_header_disabled", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
