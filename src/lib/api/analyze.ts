import {
  ANALYSES_PER_HOUR_PER_VISITOR,
  DEFAULT_DAILY_ANALYSIS_CAP,
  MAX_JD_CHARS,
  MAX_RESUME_CHARS,
  MIN_JD_CHARS,
} from "@/lib/limits";
import { RateLimiter } from "@/lib/rateLimit";
import { anthropicModel } from "@/lib/step1/anthropic";
import { demoModel } from "@/lib/step1/demo";
import { runStep1, type RunOptions } from "@/lib/step1/run";
import type { Step1ErrorCode, Step1Model } from "@/lib/step1/types";
import { clientIp, errorResponse, FORBIDDEN_MESSAGE, json, originAllowed } from "./http";

export type AnalyzeDeps = {
  model: Step1Model;
  hourlyLimiter: RateLimiter;
  dailyCap: RateLimiter;
  runOptions?: RunOptions;
};

const STEP1_ERROR_STATUS: Record<Step1ErrorCode, number> = {
  refused: 422,
  invalid_output: 502,
  ai_unavailable: 503,
};

export function createAnalyzeHandler(deps: AnalyzeDeps) {
  return async function analyze(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);

    let body: { resumeText?: unknown; jobDescription?: unknown; confirmed?: unknown };
    try {
      body = (await req.json()) ?? {};
    } catch {
      return errorResponse(400, "bad_request", "The request could not be read.");
    }

    // REQ-IN-04: the visitor must have confirmed the extracted text. The page enforces this too.
    if (body.confirmed !== true) {
      return errorResponse(400, "not_confirmed", "Please check the extracted resume text and confirm it before analysing.");
    }
    if (typeof body.resumeText !== "string" || typeof body.jobDescription !== "string") {
      return errorResponse(400, "bad_request", "The request could not be read.");
    }
    const resumeText = body.resumeText.trim();
    const jobDescription = body.jobDescription.trim();

    if (!resumeText) return errorResponse(422, "resume_empty", "The resume text is empty.");
    if (resumeText.length > MAX_RESUME_CHARS) {
      return errorResponse(422, "resume_too_long", "The resume text is longer than 50,000 characters. Please shorten it.");
    }
    if (jobDescription.length < MIN_JD_CHARS) {
      return errorResponse(422, "jd_too_short", "This job description is too short. Paste the full job posting (at least 300 characters).");
    }
    if (jobDescription.length > MAX_JD_CHARS) {
      return errorResponse(422, "jd_too_long", "The job description is longer than 20,000 characters. Please shorten it.");
    }

    const hourly = deps.hourlyLimiter.take(clientIp(req));
    if (!hourly.allowed) {
      return errorResponse(429, "rate_limited", "You've reached the limit of 10 analyses per hour. Please try again later.", {
        "retry-after": String(hourly.retryAfterSeconds),
      });
    }
    const daily = deps.dailyCap.take("global");
    if (!daily.allowed) {
      return errorResponse(503, "daily_cap_reached", "The analyzer has reached today's limit. Please try again tomorrow.", {
        "retry-after": String(daily.retryAfterSeconds),
      });
    }

    try {
      const outcome = await runStep1({ resumeText, jobDescription }, deps.model, deps.runOptions);
      if (outcome.ok) return json({ report: outcome.report });
      return errorResponse(STEP1_ERROR_STATUS[outcome.error.code], outcome.error.code, outcome.error.message);
    } catch (e) {
      // Log the error type only, never its message: it could echo resume or JD text (SEC-DATA-03).
      console.error("analyze: unexpected failure", e instanceof Error ? e.name : typeof e);
      return errorResponse(500, "internal", "Something went wrong. Please try again.");
    }
  };
}

/** Real AI when ANTHROPIC_API_KEY is set; otherwise the labelled demo analyzer (REQ-S1-03). */
export function defaultAnalyzeDeps(): AnalyzeDeps {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dailyLimit = Number(process.env.DAILY_ANALYSIS_CAP) || DEFAULT_DAILY_ANALYSIS_CAP;
  return {
    model: apiKey ? anthropicModel(apiKey) : demoModel,
    hourlyLimiter: new RateLimiter({ limit: ANALYSES_PER_HOUR_PER_VISITOR, windowMs: 60 * 60 * 1000 }),
    dailyCap: new RateLimiter({ limit: dailyLimit, windowMs: 24 * 60 * 60 * 1000 }),
  };
}
