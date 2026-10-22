import { AI_TIMEOUT_MS } from "@/lib/limits";
import { findBullets } from "@/lib/text";
import { buildStep1Prompt } from "./prompt";
import type { ModelResult, Step1Context, Step1Input, Step1Model, Step1Outcome, Step1Prompt } from "./types";
import { validateStep1 } from "./validate";

export type RunOptions = {
  timeoutMs?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const MESSAGES = {
  ai_unavailable: "The analysis service didn't respond. Please try again in a minute.",
  invalid_output: "The analysis didn't pass our quality checks, so we discarded it. Please try again.",
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function callWithTimeout(model: Step1Model, prompt: Step1Prompt, ctx: Step1Context, timeoutMs: number): Promise<ModelResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([model.generate(prompt, controller.signal, ctx), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs Step 1 end to end: one model call, then the deterministic guards.
 * A failed or timed-out call is retried once after a back-off (REQ-ERR-01); output that fails the
 * guards is re-requested once (REQ-ERR-02); a refusal is returned as-is (REQ-ERR-03).
 */
export async function runStep1(input: Step1Input, model: Step1Model, opts: RunOptions = {}): Promise<Step1Outcome> {
  const timeoutMs = opts.timeoutMs ?? AI_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const ctx = { ...input, bullets: findBullets(input.resumeText) };
  const prompt = buildStep1Prompt(ctx);

  let errorRetries = 0;
  let invalidRetries = 0;
  for (;;) {
    let result: ModelResult;
    try {
      result = await callWithTimeout(model, prompt, ctx, timeoutMs);
    } catch {
      if (errorRetries < 1) {
        errorRetries++;
        await sleep(opts.backoffMs ?? 2000);
        continue;
      }
      return { ok: false, error: { code: "ai_unavailable", message: MESSAGES.ai_unavailable } };
    }

    if (result.type === "refusal") {
      return { ok: false, error: { code: "refused", message: `The AI declined to analyse this: ${result.reason}` } };
    }

    const checked = validateStep1(result.data, ctx);
    if (checked.ok) return { ok: true, report: { ...checked.report, mode: model.mode } };
    if (invalidRetries < 1) {
      invalidRetries++;
      continue;
    }
    return { ok: false, error: { code: "invalid_output", message: MESSAGES.invalid_output } };
  }
}
