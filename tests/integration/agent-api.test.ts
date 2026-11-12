import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/extract/docx";
import { simulatedModel } from "@/lib/agent/simulated";
import { SAMPLE_NOTES, SAMPLE_POSTING, SAMPLE_RESUME } from "@/lib/agent/sample";
import { createAgentExportHandler, createAgentRunHandler, createPostingLinkHandler } from "@/lib/api/agent";
import { RateLimiter } from "@/lib/rateLimit";
import { memoryStore } from "@/lib/store";

const HOUR = 60 * 60 * 1000;

function deps() {
  return {
    model: simulatedModel,
    store: memoryStore(),
    passcode: () => "test-passcode",
    hourlyLimiter: new RateLimiter({ limit: 10, windowMs: HOUR }),
    dailyCap: new RateLimiter({ limit: 100, windowMs: HOUR }),
    exportLimiter: new RateLimiter({ limit: 60, windowMs: HOUR }),
    linkLimiter: new RateLimiter({ limit: 40, windowMs: HOUR }),
  };
}

function post(path: string, body: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin },
    body: JSON.stringify(body),
  });
}

const sample = { resumeText: SAMPLE_RESUME, notes: SAMPLE_NOTES, posting: SAMPLE_POSTING, confirmed: true, ownResumeOrSynthetic: true };

describe("agent run API", () => {
  it("test_run_requires_confirmed_resume_and_valid_posting", async () => {
    const run = createAgentRunHandler(deps());
    expect((await run(post("/api/agent/run", { ...sample, confirmed: false }))).status).toBe(400);
    const short = await run(post("/api/agent/run", { ...sample, posting: "Analyst wanted." }));
    expect(short.status).toBe(422);
    expect((await short.json()).error.code).toBe("jd_too_short");
  });

  it("test_run_requires_own_or_synthetic_statement", async () => {
    const res = await createAgentRunHandler(deps())(post("/api/agent/run", { ...sample, ownResumeOrSynthetic: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("ownership_required");
  });

  it("test_sample_run_completes_without_uploaded_resume", async () => {
    const res = await createAgentRunHandler(deps())(post("/api/agent/run", { ...sample, prepareAnyway: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("simulated");
    expect(["apply", "skip", "needs_human"]).toContain(body.decide.decision);
    expect(body.decide).not.toHaveProperty("context");
    expect(body.tailor.tailored).toContain("Jordan Lee");
    expect(body.decide.personOnly).toContain("Authorized to work in the United States without sponsorship");
  });

  it("test_cross_site_run_rejected", async () => {
    const res = await createAgentRunHandler(deps())(post("/api/agent/run", sample, "https://evil.example"));
    expect(res.status).toBe(403);
  });
});

describe("agent export API", () => {
  const exportReq = (tailored: string, format: string, template?: string) =>
    post("/api/agent/export", { tailored, format, template, resumeText: SAMPLE_RESUME, notes: SAMPLE_NOTES, posting: SAMPLE_POSTING });

  it("test_export_returns_files", async () => {
    const handler = createAgentExportHandler(deps());
    const docx = await handler(exportReq(SAMPLE_RESUME, "docx"));
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-disposition")).toContain("tailored-resume-classic.docx");
    expect(extractDocx(new Uint8Array(await docx.arrayBuffer())).text).toContain("Jordan Lee");
    const pdf = await handler(exportReq(SAMPLE_RESUME, "pdf", "modern"));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toContain("tailored-resume-modern.pdf");
    expect((await handler(exportReq(SAMPLE_RESUME, "pdf", "fancy"))).status).toBe(400);
  });

  it("test_export_refused_when_checker_finds_anything", async () => {
    const edited = SAMPLE_RESUME.replace("cut monthly reconciliation time by 6 hours", "cut monthly reconciliation time by 7 hours using Tableau");
    expect(edited).not.toBe(SAMPLE_RESUME);
    const res = await createAgentExportHandler(deps())(exportReq(edited, "pdf"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("export_blocked");
    expect(body.findings.map((f: { type: string }) => f.type)).toEqual(expect.arrayContaining(["new_number", "new_name"]));
  });
});

describe("posting link API", () => {
  it("test_link_handler_reads_supported_links_and_refuses_others", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ title: "Data Analyst Intern", company_name: "Stripe", content: `<p>${"Requirements: SQL and Excel. ".repeat(10)}</p>` }))) as typeof fetch;
    const handler = createPostingLinkHandler({ linkLimiter: new RateLimiter({ limit: 40, windowMs: HOUR }), fetchFn });
    const ok = await handler(post("/api/agent/posting", { url: "https://boards.greenhouse.io/stripe/jobs/1" }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).posting.text).toContain("Data Analyst Intern");
    const no = await handler(post("/api/agent/posting", { url: "https://www.linkedin.com/jobs/view/1" }));
    expect(no.status).toBe(422);
    expect((await no.json()).error.code).toBe("unsupported_link");
    expect((await handler(post("/api/agent/posting", { url: "https://boards.greenhouse.io/stripe/jobs/1" }, "https://evil.example"))).status).toBe(403);
  });
});
