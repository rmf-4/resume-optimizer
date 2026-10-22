import { z } from "zod";
import { MAX_KEYWORDS, MIN_KEYWORDS, WEAK_BULLET_COUNT } from "@/lib/limits";
import { containsPhrase } from "@/lib/text";
import { KEYWORD_CATEGORIES, STEP1_HEADER, WEAK_BULLET_REASONS, type Step1Context, type Step1Report } from "./types";

export const Step1OutputSchema = z.object({
  keywords: z.array(
    z.object({
      keyword: z.string(),
      category: z.enum(KEYWORD_CATEGORIES),
    }),
  ),
  weak_bullets: z.array(
    z.object({
      bullet_id: z.number().int(),
      reason: z.enum(WEAK_BULLET_REASONS),
      explanation: z.string(),
    }),
  ),
});

type Validation = { ok: true; report: Omit<Step1Report, "mode"> } | { ok: false; problems: string[] };

const MAX_EXPLANATION_CHARS = 400;

/**
 * The deterministic guard between the model and the visitor (SEC-LLM-03).
 * It enforces REQ-GEN-03..06 and REQ-S1-02 no matter what the model returned.
 */
export function validateStep1(raw: unknown, ctx: Step1Context): Validation {
  const parsed = Step1OutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: ["output does not match the expected shape"] };
  const out = parsed.data;
  const problems: string[] = [];

  // Keywords: de-duplicate, drop anything not grounded in the JD (REQ-GEN-04), set status in code (REQ-S1-02).
  const seen = new Set<string>();
  const keywords: Step1Report["keywords"] = [];
  const droppedKeywords: string[] = [];
  for (const k of out.keywords) {
    const keyword = k.keyword.trim();
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    if (!containsPhrase(ctx.jobDescription, keyword)) {
      droppedKeywords.push(keyword);
      continue;
    }
    keywords.push({
      keyword,
      category: k.category,
      status: containsPhrase(ctx.resumeText, keyword) ? "underrepresented" : "missing",
    });
  }
  if (keywords.length < MIN_KEYWORDS || keywords.length > MAX_KEYWORDS) {
    problems.push(`expected ${MIN_KEYWORDS}-${MAX_KEYWORDS} grounded keywords, got ${keywords.length}`);
  }

  // Weak bullets: referenced by ID, so every quote is verbatim by construction (REQ-GEN-05/06).
  const expected = Math.min(WEAK_BULLET_COUNT, ctx.bullets.length);
  const byId = new Map(ctx.bullets.map((b) => [b.id, b.text]));
  const usedIds = new Set<number>();
  const weakBullets: Step1Report["weakBullets"] = [];
  for (const w of out.weak_bullets) {
    const quote = byId.get(w.bullet_id);
    const explanation = w.explanation.trim();
    if (quote === undefined) problems.push(`unknown bullet id ${w.bullet_id}`);
    else if (usedIds.has(w.bullet_id)) problems.push(`bullet ${w.bullet_id} listed twice`);
    else if (!explanation || explanation.length > MAX_EXPLANATION_CHARS) problems.push(`bad explanation for bullet ${w.bullet_id}`);
    else {
      usedIds.add(w.bullet_id);
      weakBullets.push({ quote, reason: w.reason, explanation });
    }
  }
  if (out.weak_bullets.length !== expected) problems.push(`expected ${expected} weak bullets, got ${out.weak_bullets.length}`);

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    report: {
      header: STEP1_HEADER,
      keywords,
      droppedKeywords,
      weakBullets,
      bulletsFound: ctx.bullets.length,
      bulletShortfall: WEAK_BULLET_COUNT - expected,
    },
  };
}
