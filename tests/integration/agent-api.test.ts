import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/extract/docx";
import { simulatedModel } from "@/lib/agent/simulated";
import { SAMPLE_NOTES, SAMPLE_POSTING, SAMPLE_RESUME } from "@/lib/agent/sample";
import { createAgentExportHandler, createAgentRunHandler } from "@/lib/api/agent";
import { RateLimiter } from "@/lib/rateLimit";

const HOUR = 60 * 60 * 1000;

function deps() {
  return {
    model: simulatedModel,
    hourlyLimiter: new RateLimiter({ limit: 10, windowMs: HOUR }),
    dailyCap: new RateLimiter({ limit: 100, windowMs: HOUR }),
    exportLimiter: new RateLimiter({ limit: 60, windowMs: HOUR }),
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
  const exportReq = (tailored: string, format: string) =>
    post("/api/agent/export", { tailored, format, resumeText: SAMPLE_RESUME, notes: SAMPLE_NOTES, posting: SAMPLE_POSTING });

  it("test_export_returns_files", async () => {
    const handler = createAgentExportHandler(deps());
    const docx = await handler(exportReq(SAMPLE_RESUME, "docx"));
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-disposition")).toContain("tailored-resume.docx");
    expect(extractDocx(new Uint8Array(await docx.arrayBuffer())).text).toContain("Jordan Lee");
    const pdf = await handler(exportReq(SAMPLE_RESUME, "pdf"));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
  });

  it("test_export_refused_when_checker_finds_anything", async () => {
    const edited = SAMPLE_RESUME.replace("cut monthly reconciliation time by 6 hours", "cut monthly reconciliation time by 60 hours using Tableau");
    const res = await createAgentExportHandler(deps())(exportReq(edited, "pdf"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("export_blocked");
    expect(body.findings.map((f: { type: string }) => f.type)).toEqual(expect.arrayContaining(["new_number", "new_name"]));
  });
});
