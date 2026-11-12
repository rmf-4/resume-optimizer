import type { ModelResult } from "@/lib/step1/types";

export type AgentPrompt = { system: string; user: string };

/** What the decide step's model saw: cleaned, contact-redacted source facts and posting. */
export type DecideContext = { source: string; posting: string };

/** What the tailor step's model saw: redacted facts and posting, bullets by id, and the decide step's findings. */
export type TailorContext = DecideContext & {
  /** Each bullet with the heading, organisation and role lines above its run of bullets. */
  bullets: { id: number; text: string; entry?: string }[];
  /** Requirement quotes with evidence: wording the rewrites may use. */
  supported: string[];
  /** Requirement quotes with no evidence: never to be claimed. */
  gaps: string[];
  /** "Label: a, b, c" lines whose items may be reordered. */
  skillLines?: { id: number; label: string; items: string[] }[];
};

export interface AgentModel {
  /** "simulated" is the built-in non-AI stand-in (REQ-AG-40). Its results never count as evaluation evidence. */
  readonly mode: "ai" | "simulated";
  decide(prompt: AgentPrompt, signal: AbortSignal, ctx: DecideContext): Promise<ModelResult>;
  tailor(prompt: AgentPrompt, signal: AbortSignal, ctx: TailorContext): Promise<ModelResult>;
}
