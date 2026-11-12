import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MAX_OUTPUT_TOKENS } from "@/lib/limits";
import { MODEL_ID } from "@/lib/step1/anthropic";
import type { ModelResult } from "@/lib/step1/types";
import { AGENT_AI_TIMEOUT_MS } from "./config";
import { DecideOutputSchema } from "./decide";
import type { AgentModel, AgentPrompt } from "./types";

/**
 * The decide-step request. No tools, no retrieval, only this posting and these source facts (SEC-AG-05),
 * output capped (SEC-LLM-09). Same model and effort as Step 1 (A-56). Refusal fallbacks are on.
 */
export function buildDecideRequest(prompt: AgentPrompt) {
  return {
    model: MODEL_ID,
    max_tokens: AI_MAX_OUTPUT_TOKENS,
    system: prompt.system,
    messages: [{ role: "user" as const, content: prompt.user }],
    output_config: { effort: "low" as const, format: betaZodOutputFormat(DecideOutputSchema) },
    fallbacks: "default" as const,
    betas: ["server-side-fallback-2026-07-01"],
  };
}

/** Calls Claude with the server's key. Retries and timeouts are handled by the caller (REQ-AG-21, REQ-AG-38). */
export function anthropicAgentModel(apiKey: string): AgentModel {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AGENT_AI_TIMEOUT_MS });
  return {
    mode: "ai",
    async decide(prompt, signal): Promise<ModelResult> {
      let response;
      try {
        response = await client.beta.messages.parse(buildDecideRequest(prompt), { signal });
      } catch (e) {
        if (e instanceof Anthropic.APIError) throw e;
        // The SDK couldn't parse the model's JSON: invalid output (REQ-AG-21), not a service error.
        return { type: "output", data: null };
      }
      if (response.stop_reason === "refusal") {
        return { type: "refusal", reason: response.stop_details?.explanation || "The AI declined to screen this posting." };
      }
      return { type: "output", data: response.parsed_output ?? null };
    },
  };
}
