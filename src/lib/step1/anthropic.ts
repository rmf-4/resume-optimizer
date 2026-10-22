import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MAX_OUTPUT_TOKENS, AI_TIMEOUT_MS } from "@/lib/limits";
import type { ModelResult, Step1Model, Step1Prompt } from "./types";
import { Step1OutputSchema } from "./validate";

export const MODEL_ID = "claude-opus-5-5";

/**
 * The full request sent to Claude. No tools, no retrieval, only this run's inputs (SEC-LLM-02),
 * output capped (SEC-LLM-09). Refusal fallbacks are on so a classifier false-positive is retried on another model.
 */
export function buildAnthropicRequest(prompt: Step1Prompt) {
  return {
    model: MODEL_ID,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
    system: prompt.system,
    messages: [{ role: "user" as const, content: prompt.user }],
    output_config: { effort: "low" as const, format: betaZodOutputFormat(Step1OutputSchema) },
    fallbacks: "default" as const,
    betas: ["server-side-fallback-2026-07-01"],
  };
}

/** Calls Claude with the key from ANTHROPIC_API_KEY. The key never leaves the server (SEC-LLM-07). */
export function anthropicModel(apiKey: string): Step1Model {
  // Retries and timeouts are handled by runStep1 so they follow REQ-ERR-01 exactly.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS });
  return {
    mode: "ai",
    async generate(prompt, signal): Promise<ModelResult> {
      let response;
      try {
        response = await client.beta.messages.parse(buildAnthropicRequest(prompt), { signal });
      } catch (e) {
        if (e instanceof Anthropic.APIError) throw e;
        // The SDK could not parse the model's JSON: treat it as invalid output (REQ-ERR-02), not a service error.
        return { type: "output", data: null };
      }
      if (response.stop_reason === "refusal") {
        return { type: "refusal", reason: response.stop_details?.explanation || "The AI declined to analyse this resume." };
      }
      return { type: "output", data: response.parsed_output ?? null };
    },
  };
}
