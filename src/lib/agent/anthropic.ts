import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODEL_ID } from "@/lib/step1/anthropic";
import type { ModelResult } from "@/lib/step1/types";
import { AGENT_AI_TIMEOUT_MS, TAILOR_MAX_OUTPUT_TOKENS } from "./config";
import { DecideOutputSchema } from "./decide";
import { TailorOutputSchema } from "./tailor";
import type { AgentModel, AgentPrompt } from "./types";

/**
 * The decide-step request. No tools, no retrieval, only this posting and these source facts (SEC-AG-05),
 * output capped (SEC-LLM-09). High effort: the team chose quality over cost for both agent steps (A-56 changed
 * 2026-11-12), which also aims to cut run-to-run variance in the decision. Refusal fallbacks are on.
 */
export function buildDecideRequest(prompt: AgentPrompt) {
  return {
    model: MODEL_ID,
    max_tokens: TAILOR_MAX_OUTPUT_TOKENS,
    system: prompt.system,
    messages: [{ role: "user" as const, content: prompt.user }],
    output_config: { effort: "high" as const, format: betaZodOutputFormat(DecideOutputSchema) },
    fallbacks: "default" as const,
    betas: ["server-side-fallback-2026-07-01"],
  };
}

/**
 * The tailor-step request: same rules as the decide step (SEC-AG-05), with the rewrite schema. Writing is the
 * product here, so it runs at high effort with room for the model's thinking (A-56 changed for this step).
 */
export function buildTailorRequest(prompt: AgentPrompt) {
  return {
    ...buildDecideRequest(prompt),
    max_tokens: TAILOR_MAX_OUTPUT_TOKENS,
    output_config: { effort: "high" as const, format: betaZodOutputFormat(TailorOutputSchema) },
  };
}

/** Calls Claude with the server's key. Retries and timeouts are handled by the caller (REQ-AG-21, REQ-AG-38). */
export function anthropicAgentModel(apiKey: string): AgentModel {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AGENT_AI_TIMEOUT_MS });
  async function call(request: ReturnType<typeof buildDecideRequest> | ReturnType<typeof buildTailorRequest>, signal: AbortSignal): Promise<ModelResult> {
    let response;
    try {
      response = await client.beta.messages.parse(request, { signal });
    } catch (e) {
      if (e instanceof Anthropic.APIError) throw e;
      // The SDK couldn't parse the model's JSON: invalid output (REQ-AG-21), not a service error.
      return { type: "output", data: null };
    }
    if (response.stop_reason === "refusal") {
      return { type: "refusal", reason: response.stop_details?.explanation || "The AI declined this posting." };
    }
    return { type: "output", data: response.parsed_output ?? null };
  }
  return {
    mode: "ai",
    decide: (prompt, signal) => call(buildDecideRequest(prompt), signal),
    tailor: (prompt, signal) => call(buildTailorRequest(prompt), signal),
  };
}
