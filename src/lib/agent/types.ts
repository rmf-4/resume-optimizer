import type { ModelResult } from "@/lib/step1/types";

export type AgentPrompt = { system: string; user: string };

/** What the decide step's model saw: cleaned, contact-redacted source facts and posting. */
export type DecideContext = { source: string; posting: string };

export interface AgentModel {
  /** "simulated" is the built-in non-AI stand-in (REQ-AG-40). Its results never count as evaluation evidence. */
  readonly mode: "ai" | "simulated";
  decide(prompt: AgentPrompt, signal: AbortSignal, ctx: DecideContext): Promise<ModelResult>;
}
