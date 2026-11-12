import { anthropicAgentModel } from "@/lib/agent/anthropic";
import { check } from "@/lib/agent/check";
import { ExportError, exportDocx, exportPdf, TEMPLATES, type TemplateId } from "@/lib/agent/export";
import { composeSource, runDecide, type AgentErrorCode, type RunOptions } from "@/lib/agent/run";
import { runImprove } from "@/lib/agent/improve";
import { runInterview } from "@/lib/agent/interview";
import { buildPacket, PacketSchema } from "@/lib/agent/packetShape";
import { fetchPosting } from "@/lib/agent/postingLinks";
import { approvePacket, checkPasscode, level3Active, level3StopReason, readLog, startLevel3, submitToMockSite } from "@/lib/agent/submission";
import { defaultStore, type Store } from "@/lib/store";
import { simulatedModel } from "@/lib/agent/simulated";
import { runTailor } from "@/lib/agent/tailor";
import type { AgentModel } from "@/lib/agent/types";
import { scanInputs } from "@/lib/agent/warnings";
import { AGENT_MAX_NOTES_CHARS, AGENT_RUNS_PER_HOUR, DEFAULT_DAILY_ANALYSIS_CAP, MAX_JD_CHARS, MAX_RESUME_CHARS, MIN_JD_CHARS } from "@/lib/limits";
import { RateLimiter } from "@/lib/rateLimit";
import { clientIp, errorResponse, FORBIDDEN_MESSAGE, json, originAllowed } from "./http";

export type AgentDeps = {
  model: AgentModel;
  store: Store;
  /** The approval passcode (AGENT_PASSCODE). Read per request so a missing secret shows a clear message. */
  passcode: () => string | undefined;
  hourlyLimiter: RateLimiter;
  dailyCap: RateLimiter;
  exportLimiter: RateLimiter;
  linkLimiter: RateLimiter;
  runOptions?: RunOptions;
};

const ERROR_STATUS: Record<AgentErrorCode, number> = {
  refused: 422,
  invalid_output: 502,
  ai_unavailable: 503,
  not_apply: 409,
};

type Inputs = { resume: string; posting: string; notes: string };

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Shared input rules (REQ-AG-01): confirmed resume text, notes within limits, and a full posting where one is needed. */
function readInputs(body: Record<string, unknown>, resumeField: string, opts: { posting: "required" | "optional" | "none" } = { posting: "required" }): Inputs | Response {
  const resume = body[resumeField];
  const posting = body.posting ?? "";
  const notes = body.notes ?? "";
  if (typeof resume !== "string" || typeof posting !== "string" || typeof notes !== "string") {
    return errorResponse(400, "bad_request", "The request could not be read.");
  }
  const r = resume.trim();
  const p = opts.posting === "none" ? "" : posting.trim();
  const n = notes.trim();
  if (!r) return errorResponse(422, "resume_empty", "The resume text is empty.");
  if (r.length > MAX_RESUME_CHARS) return errorResponse(422, "resume_too_long", "The resume text is longer than 50,000 characters.");
  if (opts.posting === "required" || (opts.posting === "optional" && p)) {
    if (p.length < MIN_JD_CHARS) return errorResponse(422, "jd_too_short", "This posting is too short. Paste the full job posting (at least 300 characters).");
    if (p.length > MAX_JD_CHARS) return errorResponse(422, "jd_too_long", "The posting is longer than 20,000 characters.");
  }
  if (n.length > AGENT_MAX_NOTES_CHARS) return errorResponse(422, "notes_too_long", "The notes and interview answers are longer than 15,000 characters.");
  return { resume: r, posting: p, notes: n };
}

/** Confirmation, ownership and the shared limits for every model-backed agent request. */
function gate(body: Record<string, unknown>, req: Request, deps: AgentDeps): Response | null {
  if (body.confirmed !== true) return errorResponse(400, "not_confirmed", "Please check the extracted resume text and confirm it first.");
  // REQ-AG-03: only the person's own resume or a made-up one.
  if (body.ownResumeOrSynthetic !== true) return errorResponse(400, "ownership_required", "Confirm that this resume is yours or is a made-up sample.");
  const hourly = deps.hourlyLimiter.take(clientIp(req));
  if (!hourly.allowed) {
    return errorResponse(429, "rate_limited", `You've reached the limit of ${AGENT_RUNS_PER_HOUR} agent requests per hour. Please try again later.`, {
      "retry-after": String(hourly.retryAfterSeconds),
    });
  }
  const daily = deps.dailyCap.take("global");
  if (!daily.allowed) {
    return errorResponse(503, "daily_cap_reached", "The agent has reached today's limit. Please try again tomorrow.", { "retry-after": String(daily.retryAfterSeconds) });
  }
  return null;
}

function failure(e: unknown, step: string): Response {
  // Log the error type only, never its message: it could echo resume or posting text (SEC-DATA-03).
  console.error(`agent ${step}: unexpected failure`, e instanceof Error ? e.name : typeof e);
  return errorResponse(500, "internal", "Something went wrong. Please try again.");
}

/** POST /api/agent/interview: questions for the client before anything changes (REQ-AG-46). */
export function createInterviewHandler(deps: AgentDeps) {
  return async function interview(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    const inputs = readInputs(body, "resumeText", { posting: "none" });
    if (inputs instanceof Response) return inputs;
    const blocked = gate(body, req, deps);
    if (blocked) return blocked;
    try {
      const out = await runInterview({ resume: inputs.resume, notes: inputs.notes || undefined }, deps.model, deps.runOptions);
      if (!out.ok) return errorResponse(ERROR_STATUS[out.error.code], out.error.code, out.error.message);
      return json(out);
    } catch (e) {
      return failure(e, "interview");
    }
  };
}

/** POST /api/agent/improve: the master resume, built from the resume, notes and interview answers (REQ-AG-47). */
export function createImproveHandler(deps: AgentDeps) {
  return async function improve(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    const inputs = readInputs(body, "resumeText", { posting: "none" });
    if (inputs instanceof Response) return inputs;
    const blocked = gate(body, req, deps);
    if (blocked) return blocked;
    try {
      const out = await runImprove({ resume: inputs.resume, notes: inputs.notes || undefined }, deps.model, deps.runOptions);
      if (!out.ok) return errorResponse(ERROR_STATUS[out.error.code], out.error.code, out.error.message);
      return json(out.result);
    } catch (e) {
      return failure(e, "improve");
    }
  };
}

/**
 * POST /api/agent/run: decide on one posting, then tailor it if the decision is apply or the coach chose
 * "Prepare anyway". Nothing is stored yet: the result goes back to the page.
 */
export function createAgentRunHandler(deps: AgentDeps) {
  return async function run(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    const inputs = readInputs(body, "resumeText");
    if (inputs instanceof Response) return inputs;
    const blocked = gate(body, req, deps);
    if (blocked) return blocked;

    try {
      const agentInput = { resume: inputs.resume, posting: inputs.posting, notes: inputs.notes || undefined };
      const decided = await runDecide(agentInput, deps.model, deps.runOptions);
      if (!decided.ok) return errorResponse(ERROR_STATUS[decided.error.code], decided.error.code, decided.error.message);
      const { context: _context, ...decide } = decided.result;
      void _context;

      const prepareAnyway = body.prepareAnyway === true;
      if (decide.decision !== "apply" && !prepareAnyway) return json({ mode: deps.model.mode, decide, tailor: null });

      const tailored = await runTailor(agentInput, decided.result, deps.model, { ...deps.runOptions, prepareAnyway });
      if (!tailored.ok) return json({ mode: deps.model.mode, decide, tailor: null, tailorError: tailored.error });
      return json({ mode: deps.model.mode, decide, tailor: tailored.result });
    } catch (e) {
      return failure(e, "run");
    }
  };
}

const FORMATS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/**
 * POST /api/agent/export: re-runs the checker on the tailored resume against the source facts, then
 * returns a PDF or DOCX in the chosen template (REQ-AG-41, REQ-AG-43). The file is built for this request and never stored.
 * Until packets are stored on the server, the source facts come from the page, so this re-check stops
 * an edited resume, not a page that also edits its source facts.
 */
export function createAgentExportHandler(deps: Pick<AgentDeps, "exportLimiter">) {
  return async function exportResume(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    const format = body.format;
    if (format !== "pdf" && format !== "docx") return errorResponse(400, "bad_request", "Choose PDF or DOCX.");
    const template = (body.template ?? "classic") as TemplateId;
    if (!TEMPLATES.includes(template)) return errorResponse(400, "bad_request", "Choose the Classic, Modern or Compact template.");
    const tailored = body.tailored;
    if (typeof tailored !== "string" || !tailored.trim() || tailored.length > MAX_RESUME_CHARS) {
      return errorResponse(400, "bad_request", "The request could not be read.");
    }
    const inputs = readInputs(body, "resumeText", { posting: "optional" });
    if (inputs instanceof Response) return inputs;

    const limit = deps.exportLimiter.take(clientIp(req));
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "Too many downloads. Please try again later.", { "retry-after": String(limit.retryAfterSeconds) });
    }

    const { cleaned } = scanInputs({ resume: inputs.resume, posting: inputs.posting, notes: inputs.notes || undefined });
    // The posting isn't needed for this check (see below); it's accepted so a job's export carries its context.
    // No posting here: the gaps that `new_skill` needs live in the decide result, which isn't stored yet.
    // Numbers, dates, names, contacts, role inflation and hidden text are all still checked.
    const findings = check({ candidate: tailored, source: composeSource(cleaned.resume, cleaned.notes) });
    if (findings.length > 0) {
      return json(
        { error: { code: "export_blocked", message: "This resume has text the source facts don't support, so it can't be exported." }, findings },
        422,
      );
    }

    try {
      const bytes = format === "pdf" ? await exportPdf(tailored, template) : await exportDocx(tailored, template);
      return new Response(new Blob([bytes as BlobPart]), {
        status: 200,
        headers: {
          "content-type": FORMATS[format],
          "content-disposition": `attachment; filename="tailored-resume-${template}.${format}"`,
          "cache-control": "no-store",
        },
      });
    } catch (e) {
      if (e instanceof ExportError) return errorResponse(422, e.code, e.message);
      console.error("agent export: unexpected failure", e instanceof Error ? e.name : typeof e);
      return errorResponse(500, "internal", "Something went wrong. Please try again.");
    }
  };
}

const LINK_ERROR_STATUS = { unsupported_link: 422, posting_not_found: 404, fetch_failed: 502, posting_too_long: 422, posting_too_short: 422 } as const;

/**
 * POST /api/agent/posting: reads one posting from a supported job board's public API (REQ-AG-05, A-63).
 * The link itself is never fetched; see postingLinks.ts.
 */
export function createPostingLinkHandler(deps: { linkLimiter: RateLimiter; fetchFn?: typeof fetch }) {
  return async function postingLink(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body || typeof body.url !== "string" || body.url.length > 500) return errorResponse(400, "bad_request", "Paste a link to a job posting.");
    const limit = deps.linkLimiter.take(clientIp(req));
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "Too many links in an hour. Paste the posting text instead, or try later.", { "retry-after": String(limit.retryAfterSeconds) });
    }
    const result = await fetchPosting(body.url, deps.fetchFn);
    if (!result.ok) return errorResponse(LINK_ERROR_STATUS[result.code], result.code, result.message);
    return json({ posting: result.posting });
  };
}

// ---------- approval, the mock application site and level 3 (REQ-AG-24 to REQ-AG-35) ----------

const PASSCODE_STATUS = { not_configured: 503, wrong_passcode: 401, too_many_attempts: 429 } as const;

/** POST /api/agent/approve: a person approves one packet with their name and the passcode (REQ-AG-27). */
export function createApproveHandler(deps: AgentDeps) {
  return async function approve(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    const packet = PacketSchema.safeParse(body?.packet);
    if (!body || !packet.success) return errorResponse(400, "bad_request", "The request could not be read.");
    const approver = typeof body.approverName === "string" ? body.approverName.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!approver) return errorResponse(422, "approver_required", "Type your name to approve.");
    if (body.reviewed !== true) return errorResponse(422, "review_required", "Confirm you've read every change and checked each flag.");
    const inputs = readInputs(body, "resumeText", { posting: "none" });
    if (inputs instanceof Response) return inputs;
    try {
      const pass = await checkPasscode(deps.store, clientIp(req), body.passcode, deps.passcode());
      if (!pass.ok) return errorResponse(PASSCODE_STATUS[pass.code], pass.code, pass.message);
      const out = await approvePacket({ store: deps.store, packet: packet.data, resumeText: inputs.resume, notes: inputs.notes || undefined, approver, level: 2 });
      if (!out.ok) return json({ error: { code: out.code, message: out.message }, findings: out.findings }, 422);
      return json({ packetHash: out.packetHash });
    } catch (e) {
      return failure(e, "approve");
    }
  };
}

/** POST /api/mock/apply: the mock employer's application endpoint. The only place anything is ever submitted. */
export function createMockApplyHandler(deps: Pick<AgentDeps, "store">) {
  return async function apply(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    const packet = PacketSchema.safeParse(body?.packet);
    if (!body || !packet.success) return errorResponse(400, "bad_request", "The request could not be read.");
    const answers: Record<string, string> = {};
    if (body.answers && typeof body.answers === "object") {
      for (const [q, a] of Object.entries(body.answers as Record<string, unknown>)) if (typeof a === "string") answers[q] = a.slice(0, 1000);
    }
    try {
      const out = await submitToMockSite({ store: deps.store, packet: packet.data, answers });
      if (!out.ok) return json({ error: { code: out.code, message: out.message }, entry: out.entry }, out.status);
      return json({ entry: out.entry });
    } catch (e) {
      return failure(e, "mock apply");
    }
  };
}

/** POST /api/agent/level3: a person starts a level 3 session with the passcode (REQ-AG-30). */
export function createLevel3Handler(deps: AgentDeps) {
  return async function level3(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    try {
      const pass = await checkPasscode(deps.store, clientIp(req), body.passcode, deps.passcode());
      if (!pass.ok) return errorResponse(PASSCODE_STATUS[pass.code], pass.code, pass.message);
      return json(await startLevel3(deps.store));
    } catch (e) {
      return failure(e, "level 3");
    }
  };
}

/**
 * POST /api/agent/auto: level 3 for one posting. The server runs the decision and tailoring itself, so the
 * page can't claim a job is clean, then submits to the mock site only if nothing needs a person (REQ-AG-31).
 */
export function createAutoHandler(deps: AgentDeps) {
  return async function auto(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    const inputs = readInputs(body, "resumeText");
    if (inputs instanceof Response) return inputs;
    try {
      if (!(await level3Active(deps.store, body.level3Token))) {
        return errorResponse(403, "level3_not_started", "Level 3 isn't on. Turn it on with the passcode first.");
      }
      const blocked = gate(body, req, deps);
      if (blocked) return blocked;
      const agentInput = { resume: inputs.resume, posting: inputs.posting, notes: inputs.notes || undefined };
      const decided = await runDecide(agentInput, deps.model, deps.runOptions);
      if (!decided.ok) return errorResponse(ERROR_STATUS[decided.error.code], decided.error.code, decided.error.message);
      const { context: _context, ...decide } = decided.result;
      void _context;
      const title = typeof body.postingTitle === "string" ? body.postingTitle.slice(0, 300) : inputs.posting.split("\n")[0].slice(0, 120);
      if (decide.decision !== "apply") {
        return json({ mode: deps.model.mode, decide, tailor: null, auto: { status: "stopped", reason: level3StopReason({ ...emptyPacket, decision: decide.decision }) } });
      }
      const tailored = await runTailor(agentInput, decided.result, deps.model, deps.runOptions);
      if (!tailored.ok) return json({ mode: deps.model.mode, decide, tailor: null, tailorError: tailored.error, auto: { status: "stopped", reason: tailored.error.message } });
      const packet = buildPacket({ postingTitle: title, posting: inputs.posting, decide, tailor: tailored.result, mode: deps.model.mode });
      const stop = level3StopReason(packet);
      if (stop) return json({ mode: deps.model.mode, decide, tailor: tailored.result, auto: { status: "stopped", reason: stop } });
      const approved = await approvePacket({ store: deps.store, packet, resumeText: inputs.resume, notes: inputs.notes || undefined, approver: "auto (level 3)", level: 3 });
      if (!approved.ok) return json({ mode: deps.model.mode, decide, tailor: tailored.result, auto: { status: "stopped", reason: approved.message } });
      const sent = await submitToMockSite({ store: deps.store, packet, answers: {} });
      return json({
        mode: deps.model.mode,
        decide,
        tailor: tailored.result,
        auto: sent.ok ? { status: "submitted", entry: sent.entry } : { status: "stopped", reason: sent.message },
      });
    } catch (e) {
      return failure(e, "auto");
    }
  };
}

const emptyPacket = { postingTitle: "", posting: "", resume: "", decision: "apply" as const, coverage: null, warnings: [], flags: 0, personOnly: [], mode: "ai" as const };

/** POST /api/mock/log: the mock site's log, behind the passcode (REQ-AG-35). POST keeps the passcode out of URLs. */
export function createLogHandler(deps: AgentDeps) {
  return async function log(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);
    const body = await readBody(req);
    if (!body) return errorResponse(400, "bad_request", "The request could not be read.");
    try {
      const pass = await checkPasscode(deps.store, clientIp(req), body.passcode, deps.passcode());
      if (!pass.ok) return errorResponse(PASSCODE_STATUS[pass.code], pass.code, pass.message);
      return json({ entries: await readLog(deps.store) });
    } catch (e) {
      return failure(e, "log");
    }
  };
}

/** Real AI when ANTHROPIC_API_KEY is set; otherwise the labelled simulated model (REQ-AG-40). */
export function defaultAgentDeps(): AgentDeps {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dailyLimit = Number(process.env.DAILY_ANALYSIS_CAP) || DEFAULT_DAILY_ANALYSIS_CAP;
  return {
    model: apiKey ? anthropicAgentModel(apiKey) : simulatedModel,
    store: defaultStore(),
    passcode: () => process.env.AGENT_PASSCODE,
    hourlyLimiter: new RateLimiter({ limit: AGENT_RUNS_PER_HOUR, windowMs: 60 * 60 * 1000 }),
    dailyCap: new RateLimiter({ limit: dailyLimit, windowMs: 24 * 60 * 60 * 1000 }),
    exportLimiter: new RateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 }),
    linkLimiter: new RateLimiter({ limit: 40, windowMs: 60 * 60 * 1000 }),
  };
}
