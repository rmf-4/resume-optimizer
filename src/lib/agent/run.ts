import type { ModelResult } from "@/lib/step1/types";
import { AGENT_AI_TIMEOUT_MS } from "./config";
import { decide, validateDecide, type DecisionSummary, type Requirement } from "./decide";
import { buildDecidePrompt } from "./prompt";
import { redactContacts } from "./redact";
import type { AgentModel, AgentPrompt, DecideContext } from "./types";
import { scanInputs, type AgentInputs, type InputWarning } from "./warnings";

export type RunOptions = {
  timeoutMs?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type DecideResult = DecisionSummary & {
  mode: AgentModel["mode"];
  requirements: Requirement[];
  /** Requirements the model returned that aren't verbatim in the posting. */
  dropped: string[];
  /** Evidence the model returned that isn't verbatim in the source facts. */
  discardedEvidence: string[];
  warnings: InputWarning[];
  /** The cleaned, redacted source facts the model saw. Later steps check against these. */
  context: DecideContext;
};

export type AgentErrorCode = "ai_unavailable" | "invalid_output" | "refused" | "not_apply";
export type DecideOutcome = { ok: true; result: DecideResult } | { ok: false; error: { code: AgentErrorCode; message: string } };

const MESSAGES = {
  ai_unavailable: "The AI service didn't respond for this posting. Try it again in a minute.",
  invalid_output: "The AI's answer for this posting didn't have the expected shape twice in a row, so this posting failed.",
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Source facts as the model sees them: resume, then the coach's notes. */
export function composeSource(resume: string, notes?: string): string {
  return notes && notes.trim() ? `${resume}\n\nCoach notes:\n${notes.trim()}` : resume;
}

async function withTimeout(call: (signal: AbortSignal) => Promise<ModelResult>, timeoutMs: number): Promise<ModelResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([call(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls a model step with the agent's retry rules: a failed or timed-out call is retried once after a
 * back-off (REQ-ERR-01); output that fails `accept` is re-requested once, then the posting fails (REQ-AG-21).
 */
export async function callModelStep<T>(
  call: (signal: AbortSignal) => Promise<ModelResult>,
  accept: (data: unknown) => T | null,
  opts: RunOptions = {},
): Promise<{ ok: true; value: T } | { ok: false; error: { code: AgentErrorCode; message: string } }> {
  const timeoutMs = opts.timeoutMs ?? AGENT_AI_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  let errorRetries = 0;
  let invalidRetries = 0;
  for (;;) {
    let result: ModelResult;
    try {
      result = await withTimeout(call, timeoutMs);
    } catch {
      if (errorRetries < 1) {
        errorRetries++;
        await sleep(opts.backoffMs ?? 2000);
        continue;
      }
      return { ok: false, error: { code: "ai_unavailable", message: MESSAGES.ai_unavailable } };
    }
    if (result.type === "refusal") {
      return { ok: false, error: { code: "refused", message: `The AI declined this posting: ${result.reason}` } };
    }
    const value = accept(result.data);
    if (value !== null) return { ok: true, value };
    if (invalidRetries < 1) {
      invalidRetries++;
      continue;
    }
    return { ok: false, error: { code: "invalid_output", message: MESSAGES.invalid_output } };
  }
}

/**
 * The decide step for one posting: strip invisible text and warn (SEC-AG-03, SEC-AG-04), redact contact
 * details (SEC-AG-06), ask the model for requirements and evidence, check every quote (REQ-AG-07),
 * then decide in code (REQ-AG-08 to REQ-AG-11).
 */
export async function runDecide(input: AgentInputs, model: AgentModel, opts: RunOptions = {}): Promise<DecideOutcome> {
  const { warnings, cleaned } = scanInputs(input);
  const ctx: DecideContext = {
    source: redactContacts(composeSource(cleaned.resume, cleaned.notes)),
    posting: redactContacts(cleaned.posting),
  };
  const prompt: AgentPrompt = buildDecidePrompt(ctx);

  const step = await callModelStep(
    (signal) => model.decide(prompt, signal, ctx),
    (data) => {
      const v = validateDecide(data, ctx);
      return v.ok ? v : null;
    },
    opts,
  );
  if (!step.ok) return step;

  const { requirements, dropped, discardedEvidence } = step.value;
  const summary = decide({ requirements, warnings });
  return { ok: true, result: { ...summary, mode: model.mode, requirements, dropped, discardedEvidence, warnings, context: ctx } };
}
