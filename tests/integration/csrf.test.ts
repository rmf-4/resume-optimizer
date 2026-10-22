import { describe, expect, it } from "vitest";
import { createAnalyzeHandler } from "@/lib/api/analyze";
import { handleExtract } from "@/lib/api/extract";
import { RateLimiter } from "@/lib/rateLimit";
import { demoModel } from "@/lib/step1/demo";
import { JOB_DESCRIPTION, makePdf, RESUME_TEXT } from "../helpers/fixtures";

// SEC-SESS-04: a state-changing request with a missing or mismatched Origin is rejected with 403.
// Browsers always send Origin on a POST, so a POST without one did not come from this site's page.

function analyzeHandler() {
  return createAnalyzeHandler({
    model: demoModel,
    hourlyLimiter: new RateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }),
    dailyCap: new RateLimiter({ limit: 200, windowMs: 24 * 60 * 60 * 1000 }),
  });
}

describe("SEC-SESS-04 cross-site request protection", () => {
  it("The server rejects an analysis request that arrives without an Origin header", async () => {
    const req = new Request("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000" },
      body: JSON.stringify({ resumeText: RESUME_TEXT, jobDescription: JOB_DESCRIPTION, confirmed: true }),
    });
    const res = await analyzeHandler()(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("The server rejects a file upload that arrives without an Origin header", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(await makePdf())], "resume.pdf"));
    const res = await handleExtract(new Request("http://localhost:3000/api/extract", { method: "POST", body: form, headers: { host: "localhost:3000" } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
  });

  it("The server still accepts a request whose Origin matches the site", async () => {
    const req = new Request("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000" },
      body: JSON.stringify({ resumeText: RESUME_TEXT, jobDescription: JOB_DESCRIPTION, confirmed: true }),
    });
    expect((await analyzeHandler()(req)).status).toBe(200);
  });
});
