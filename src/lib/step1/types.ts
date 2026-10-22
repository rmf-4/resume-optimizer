import type { Bullet } from "@/lib/text";

export const STEP1_HEADER = "Step 1: ATS & Keyword Gap Analysis";

export const KEYWORD_CATEGORIES = ["hard skill", "soft skill", "tool", "industry term"] as const;
export const WEAK_BULLET_REASONS = ["generic", "no measurable impact", "passive phrasing"] as const;

export type KeywordCategory = (typeof KEYWORD_CATEGORIES)[number];
export type WeakBulletReason = (typeof WEAK_BULLET_REASONS)[number];
export type KeywordStatus = "missing" | "underrepresented";

export type Step1Input = { resumeText: string; jobDescription: string };
export type Step1Context = Step1Input & { bullets: Bullet[] };

export type Step1Prompt = { system: string; user: string };

/** What the model is asked to return: categories and bullet IDs only. Status and quotes are filled in by code. */
export type Step1ModelOutput = {
  keywords: { keyword: string; category: KeywordCategory }[];
  weak_bullets: { bullet_id: number; reason: WeakBulletReason; explanation: string }[];
};

export type ModelResult = { type: "output"; data: unknown } | { type: "refusal"; reason: string };

export interface Step1Model {
  /** "demo" means the built-in non-AI analyzer (REQ-S1-03). */
  readonly mode: "ai" | "demo";
  generate(prompt: Step1Prompt, signal: AbortSignal, ctx: Step1Context): Promise<ModelResult>;
}

export type Step1Report = {
  header: typeof STEP1_HEADER;
  mode: "ai" | "demo";
  keywords: { keyword: string; category: KeywordCategory; status: KeywordStatus }[];
  droppedKeywords: string[];
  weakBullets: { quote: string; reason: WeakBulletReason; explanation: string }[];
  bulletsFound: number;
  bulletShortfall: number;
};

export type Step1ErrorCode = "ai_unavailable" | "invalid_output" | "refused";

export type Step1Outcome = { ok: true; report: Step1Report } | { ok: false; error: { code: Step1ErrorCode; message: string } };
