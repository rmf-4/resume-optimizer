import { anthropicAgentModel } from "@/lib/agent/anthropic";
import { check } from "@/lib/agent/check";
import { ExportError, exportDocx, exportPdf } from "@/lib/agent/export";
import { composeSource, runDecide, type AgentErrorCode, type RunOptions } from "@/lib/agent/run";
import { simulatedModel } from "@/lib/agent/simulated";
import { runTailor } from "@/lib/agent/tailor";
import type { AgentModel } from "@/lib/agent/types";
import { scanInputs } from "@/lib/agent/warnings";
import {
  ANALYSES_PER_HOUR_PER_VISITOR,
  DEFAULT_DAILY_ANALYSIS_CAP,
  MAX_JD_CHARS,
  MAX_NOTES_CHARS,
  MAX_RESUME_CHARS,
  MIN_JD_CHARS,
} from "@/lib/limits";
import { RateLimiter } from "@/lib/rateLimit";
import { clientIp, errorResponse, FORBIDDEN_MESSAGE, json, originAllowed } from "./http";

export type AgentDeps = {
  model: AgentModel;
  hourlyLimiter: RateLimiter;
  dailyCap: RateLimiter;
  exportLimiter: RateLimiter;
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

/** Shared input rules (REQ-AG-01): confirmed resume text, a full posting, notes within limits. */
function readInputs(body: Record<string, unknown>, resumeField: string): Inputs | Response {
  const resume = body[resumeField];
  const posting = body.posting;
  const notes = body.notes ?? "";
  if (typeof resume !== "string" || typeof posting !== "string" || typeof notes !== "string") {
    return errorResponse(400, "bad_request", "The request could not be read.");
  }
  const r = resume.trim();
  const p = posting.trim();
  const n = notes.trim();
  if (!r) return errorResponse(422, "resume_empty", "The resume text is empty.");
  if (r.length > MAX_RESUME_CHARS) return errorResponse(422, "resume_too_long", "The resume text is longer than 50,000 characters.");
  if (p.length < MIN_JD_CHARS) return errorResponse(422, "jd_too_short", "This posting is too short. Paste the full job posting (at least 300 characters).");
  if (p.length > MAX_JD_CHARS) return errorResponse(422, "jd_too_long", "The posting is longer than 20,000 characters.");
  if (n.length > MAX_NOTES_CHARS) return errorResponse(422, "notes_too_long", "The notes are longer than 10,000 characters.");
  return { resume: r, posting: p, notes: n };
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
    if (body.confirmed !== true) {
      return errorResponse(400, "not_confirmed", "Please check the extracted resume text and confirm it first.");
    }
    // REQ-AG-03: only the person's own resume or a made-up one.
    if (body.ownResumeOrSynthetic !== true) {
      return errorResponse(400, "ownership_required", "Confirm that this resume is yours or is a made-up sample.");
    }
    const inputs = readInputs(body, "resumeText");
    if (inputs instanceof Response) return inputs;

    const hourly = deps.hourlyLimiter.take(clientIp(req));
    if (!hourly.allowed) {
      return errorResponse(429, "rate_limited", "You've reached the limit of 10 agent runs per hour. Please try again later.", {
        "retry-after": String(hourly.retryAfterSeconds),
      });
    }
    const daily = deps.dailyCap.take("global");
    if (!daily.allowed) {
      return errorResponse(503, "daily_cap_reached", "The agent has reached today's limit. Please try again tomorrow.", {
        "retry-after": String(daily.retryAfterSeconds),
      });
    }

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
      // Log the error type only, never its message: it could echo resume or posting text (SEC-DATA-03).
      console.error("agent run: unexpected failure", e instanceof Error ? e.name : typeof e);
      return errorResponse(500, "internal", "Something went wrong. Please try again.");
    }
  };
}

const FORMATS = {
  pdf: { type: "application/pdf", file: "tailored-resume.pdf" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", file: "tailored-resume.docx" },
} as const;

/**
 * POST /api/agent/export: re-runs the checker on the tailored resume against the source facts, then
 * returns a PDF or DOCX (REQ-AG-41, REQ-AG-43). The file is built for this request and never stored.
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
    const tailored = body.tailored;
    if (typeof tailored !== "string" || !tailored.trim() || tailored.length > MAX_RESUME_CHARS) {
      return errorResponse(400, "bad_request", "The request could not be read.");
    }
    const inputs = readInputs(body, "resumeText");
    if (inputs instanceof Response) return inputs;

    const limit = deps.exportLimiter.take(clientIp(req));
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "Too many downloads. Please try again later.", { "retry-after": String(limit.retryAfterSeconds) });
    }

    const { cleaned } = scanInputs({ resume: inputs.resume, posting: inputs.posting, notes: inputs.notes || undefined });
    const findings = check({ candidate: tailored, source: composeSource(cleaned.resume, cleaned.notes), posting: cleaned.posting });
    if (findings.length > 0) {
      return json(
        { error: { code: "export_blocked", message: "This resume has text the source facts don't support, so it can't be exported." }, findings },
        422,
      );
    }

    try {
      const bytes = format === "pdf" ? await exportPdf(tailored) : exportDocx(tailored);
      return new Response(new Blob([bytes as BlobPart]), {
        status: 200,
        headers: {
          "content-type": FORMATS[format].type,
          "content-disposition": `attachment; filename="${FORMATS[format].file}"`,
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

/** Real AI when ANTHROPIC_API_KEY is set; otherwise the labelled simulated model (REQ-AG-40). */
export function defaultAgentDeps(): AgentDeps {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dailyLimit = Number(process.env.DAILY_ANALYSIS_CAP) || DEFAULT_DAILY_ANALYSIS_CAP;
  return {
    model: apiKey ? anthropicAgentModel(apiKey) : simulatedModel,
    hourlyLimiter: new RateLimiter({ limit: ANALYSES_PER_HOUR_PER_VISITOR, windowMs: 60 * 60 * 1000 }),
    dailyCap: new RateLimiter({ limit: dailyLimit, windowMs: 24 * 60 * 60 * 1000 }),
    exportLimiter: new RateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 }),
  };
}
