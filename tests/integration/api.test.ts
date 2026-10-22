import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalyzeHandler } from "@/lib/api/analyze";
import { handleExtract } from "@/lib/api/extract";
import { RateLimiter } from "@/lib/rateLimit";
import type { ModelResult, Step1Model } from "@/lib/step1/types";
import { JOB_DESCRIPTION, makeDocx, makePdf, RESUME_TEXT, uploadRequest } from "../helpers/fixtures";

const VALID = {
  keywords: [
    { keyword: "demand forecasting", category: "hard skill" },
    { keyword: "Tableau", category: "tool" },
    { keyword: "SQL", category: "tool" },
    { keyword: "Power BI", category: "tool" },
    { keyword: "vendor management", category: "hard skill" },
    { keyword: "Lean Six Sigma", category: "industry term" },
    { keyword: "stakeholder management", category: "soft skill" },
    { keyword: "SAP", category: "tool" },
  ],
  weak_bullets: [
    { bullet_id: 1, reason: "passive phrasing", explanation: "Describes a duty, not a result." },
    { bullet_id: 2, reason: "generic", explanation: "Vague about what was done." },
    { bullet_id: 4, reason: "no measurable impact", explanation: "No outcome given." },
  ],
};

function capturingModel(result: ModelResult = { type: "output", data: VALID }) {
  const prompts: string[] = [];
  const model: Step1Model = {
    mode: "ai",
    async generate(prompt) {
      prompts.push(prompt.user);
      return result;
    },
  };
  return { model, prompts };
}

function makeHandler(opts: { model?: Step1Model; hourly?: number; daily?: number } = {}) {
  return createAnalyzeHandler({
    model: opts.model ?? capturingModel().model,
    hourlyLimiter: new RateLimiter({ limit: opts.hourly ?? 10, windowMs: 60 * 60 * 1000 }),
    dailyCap: new RateLimiter({ limit: opts.daily ?? 200, windowMs: 24 * 60 * 60 * 1000 }),
    runOptions: { timeoutMs: 1000, sleep: async () => {} },
  });
}

function analyzeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", "x-forwarded-for": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
}

const goodBody = { resumeText: RESUME_TEXT, jobDescription: JOB_DESCRIPTION, confirmed: true };

afterEach(() => vi.restoreAllMocks());

describe("POST /api/extract", () => {
  it("test_extract_endpoint_returns_text_for_valid_upload", async () => {
    const res = await handleExtract(uploadRequest(await makePdf(), "resume.pdf", { type: "application/pdf", origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fileType).toBe("pdf");
    expect(json.text).toContain("Northwind Logistics");
    expect(json.hiddenText).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("test_type_detection_ignores_extension_and_content_type_via_api", async () => {
    // DOCX bytes uploaded as "resume.pdf" with a PDF content type are handled as DOCX.
    const res = await handleExtract(uploadRequest(makeDocx(), "resume.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(200);
    expect((await res.json()).fileType).toBe("docx");
  });

  it("test_extract_rejection_returns_code_and_message", async () => {
    const res = await handleExtract(uploadRequest(await makePdf({ pages: 11 }), "long.pdf"));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("too_many_pages");
    expect(json.error.message).toMatch(/10 pages/);
  });

  it("test_extract_without_file_is_rejected", async () => {
    const req = new Request("http://localhost:3000/api/extract", { method: "POST", body: new FormData(), headers: { host: "localhost:3000" } });
    const res = await handleExtract(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("no_file");
  });

  it("test_csrf_bad_origin_rejected_on_extract", async () => {
    const res = await handleExtract(uploadRequest(await makePdf(), "resume.pdf", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/analyze inputs", () => {
  it("test_analyze_returns_step1_report", async () => {
    const res = await makeHandler()(analyzeRequest(goodBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.report.header).toBe("Step 1: ATS & Keyword Gap Analysis");
    expect(json.report.mode).toBe("ai");
    expect(json.report.keywords).toHaveLength(8);
  });

  it("test_generation_requires_confirmed_extracted_text", async () => {
    const handler = makeHandler();
    const res = await handler(analyzeRequest({ ...goodBody, confirmed: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("not_confirmed");
    const missing = await handler(analyzeRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_DESCRIPTION }));
    expect(missing.status).toBe(400);
  });

  it("test_jd_accepts_paste_up_to_20000", async () => {
    const handler = makeHandler();
    const atLimit = JOB_DESCRIPTION + " ".repeat(0) + "x".repeat(20000 - JOB_DESCRIPTION.length);
    expect(atLimit.length).toBe(20000);
    expect((await handler(analyzeRequest({ ...goodBody, jobDescription: atLimit }))).status).toBe(200);
    const over = await handler(analyzeRequest({ ...goodBody, jobDescription: atLimit + "x" }));
    expect(over.status).toBe(422);
    expect((await over.json()).error.code).toBe("jd_too_long");
  });

  it("test_jd_under_300_chars_blocks_generation", async () => {
    const res = await makeHandler()(analyzeRequest({ ...goodBody, jobDescription: "   " + "a".repeat(299) + "   " }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("jd_too_short");
    expect(json.error.message).toMatch(/full (job )?posting/i);
  });

  it("test_resume_text_over_50000_rejected", async () => {
    const res = await makeHandler()(analyzeRequest({ ...goodBody, resumeText: "a".repeat(50001) }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("resume_too_long");
  });

  it("test_llm_receives_only_confirmed_stripped_text", async () => {
    const { model, prompts } = capturingModel();
    await makeHandler({ model })(analyzeRequest({ ...goodBody, resumeText: RESUME_TEXT + "\nCOACH-EDITED-LINE" }));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("COACH-EDITED-LINE");
  });

  it("test_csrf_bad_origin_rejected", async () => {
    const res = await makeHandler()(analyzeRequest(goodBody, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    const ok = await makeHandler()(analyzeRequest(goodBody, { origin: "http://localhost:3000" }));
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/analyze limits and failures", () => {
  it("test_rate_limits_return_429_with_retry_after", async () => {
    const handler = makeHandler({ hourly: 10 });
    for (let i = 0; i < 10; i++) expect((await handler(analyzeRequest(goodBody))).status).toBe(200);
    const res = await handler(analyzeRequest(goodBody));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different visitor is unaffected.
    expect((await handler(analyzeRequest(goodBody, { "x-forwarded-for": "198.51.100.2" }))).status).toBe(200);
  });

  it("test_daily_cap_pauses_analysis", async () => {
    const handler = makeHandler({ daily: 2 });
    expect((await handler(analyzeRequest(goodBody, { "x-forwarded-for": "198.51.100.1" }))).status).toBe(200);
    expect((await handler(analyzeRequest(goodBody, { "x-forwarded-for": "198.51.100.2" }))).status).toBe(200);
    const res = await handler(analyzeRequest(goodBody, { "x-forwarded-for": "198.51.100.3" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("daily_cap_reached");
  });

  it("test_model_refusal_returned_as_plain_text_error", async () => {
    const { model } = capturingModel({ type: "refusal", reason: "I can't help with that request." });
    const res = await makeHandler({ model })(analyzeRequest(goodBody));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe("refused");
    expect(json.error.message).toContain("I can't help with that request.");
  });

  it("test_invalid_output_returns_error_and_no_report", async () => {
    const { model } = capturingModel({ type: "output", data: { nonsense: true } });
    const res = await makeHandler({ model })(analyzeRequest(goodBody));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.report).toBeUndefined();
    expect(json.error.code).toBe("invalid_output");
  });

  it("test_logs_and_error_reports_contain_no_pii_or_secrets", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const canary = "CANARY-7f3a9 Jordan Lee";
    const body = { ...goodBody, resumeText: RESUME_TEXT + "\n• " + canary, jobDescription: JOB_DESCRIPTION + "\n" + canary };
    await makeHandler()(analyzeRequest(body));
    const failing: Step1Model = { mode: "ai", generate: async () => { throw new Error("boom " + canary); } };
    await makeHandler({ model: failing })(analyzeRequest(body));
    const { model: bad } = capturingModel({ type: "output", data: { canary } });
    await makeHandler({ model: bad })(analyzeRequest(body));
    await handleExtract(uploadRequest(new TextEncoder().encode(canary), "x.txt"));
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
    expect(logged).not.toContain("CANARY-7f3a9");
  });
});
