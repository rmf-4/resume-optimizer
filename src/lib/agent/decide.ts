// The decide step's guard and decision (REQ-AG-06 to REQ-AG-11). The model only lists requirements and
// quotes evidence; this code checks every quote and makes the call.

import { z } from "zod";
import { APPLY_AT, MAX_EVIDENCE, MAX_REQUIREMENTS, MIN_MUST_HAVES, SKIP_BELOW } from "./config";
import type { DecideContext } from "./types";
import type { InputWarning } from "./warnings";

export const PRIORITIES = ["must", "nice"] as const;
export const REQUIREMENT_KINDS = ["skill", "credential", "person"] as const;

export const DecideOutputSchema = z.object({
  requirements: z.array(
    z.object({
      quote: z.string(),
      priority: z.enum(PRIORITIES),
      kind: z.enum(REQUIREMENT_KINDS),
      evidence: z.array(z.string()),
    }),
  ),
});

export type Requirement = z.infer<typeof DecideOutputSchema>["requirements"][number];
export type Decision = "apply" | "skip" | "needs_human";

/** Comparison form for verbatim checks: case, whitespace, curly quotes, dashes and bullet markers don't count. */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'•▪◦‣∙·●\-*]\s*/, "")
    .replace(/["']$/, "")
    .replace(/[.;,:]+$/, "")
    .trim()
    .toLowerCase();
}

function isVerbatim(quote: string, normalizedText: string): boolean {
  const q = normalizeQuote(quote);
  return q.length >= 2 && normalizedText.includes(q);
}

type Validation =
  | { ok: true; requirements: Requirement[]; dropped: string[]; discardedEvidence: string[] }
  | { ok: false; problems: string[] };

/**
 * Checks the model's output against the posting and source facts it saw (REQ-AG-07): a requirement not
 * quoted verbatim from the posting is dropped, and evidence not quoted verbatim from the source facts is discarded.
 * Only a schema failure makes the output invalid (REQ-AG-21).
 */
export function validateDecide(raw: unknown, ctx: DecideContext): Validation {
  const parsed = DecideOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: ["output does not match the expected shape"] };

  const posting = normalizeQuote(ctx.posting);
  const source = normalizeQuote(ctx.source);
  const requirements: Requirement[] = [];
  const dropped: string[] = [];
  const discardedEvidence: string[] = [];
  const seen = new Set<string>();

  for (const r of parsed.data.requirements.slice(0, MAX_REQUIREMENTS)) {
    const quote = r.quote.trim();
    const key = normalizeQuote(quote);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!isVerbatim(quote, posting)) {
      dropped.push(quote);
      continue;
    }
    const evidence: string[] = [];
    for (const e of r.evidence) {
      const ev = e.trim();
      if (!ev || evidence.some((x) => normalizeQuote(x) === normalizeQuote(ev))) continue;
      if (isVerbatim(ev, source)) evidence.push(ev);
      else discardedEvidence.push(ev);
    }
    requirements.push({ quote, priority: r.priority, kind: r.kind, evidence: evidence.slice(0, MAX_EVIDENCE) });
  }
  return { ok: true, requirements, dropped, discardedEvidence };
}

export type DecisionSummary = {
  decision: Decision;
  reasons: string[];
  /** Supported must-haves ÷ must-haves, person-only left out (REQ-AG-08). Not an ATS score (REQ-AG-12). Null when there are none. */
  coverage: number | null;
  mustHaves: number;
  supported: number;
  /** Must-haves with no evidence: these go to gaps, never into the resume. */
  gaps: string[];
  /** Requirements only the client can answer (work authorization, salary, relocation...). */
  personOnly: string[];
};

/** Sets the decision in code (REQ-AG-09, REQ-AG-10, REQ-AG-11). */
export function decide({ requirements, warnings }: { requirements: Requirement[]; warnings: InputWarning[] }): DecisionSummary {
  const checkable = requirements.filter((r) => r.priority === "must" && r.kind !== "person");
  const supported = checkable.filter((r) => r.evidence.length > 0);
  const coverage = checkable.length > 0 ? supported.length / checkable.length : null;
  const gaps = checkable.filter((r) => r.evidence.length === 0).map((r) => r.quote);
  const personOnly = requirements.filter((r) => r.kind === "person").map((r) => r.quote);
  const missingCredentials = checkable.filter((r) => r.kind === "credential" && r.evidence.length === 0);

  const reasons: string[] = [];
  if (coverage !== null) {
    reasons.push(`${supported.length} of ${checkable.length} must-have requirements have evidence in the source facts (${Math.round(coverage * 100)}%).`);
  }

  let decision: Decision;
  if (warnings.length > 0) {
    decision = "needs_human";
    for (const w of warnings) reasons.push(`Warning (${w.kind.replace("_", " ")} in the ${w.input}): "${w.quote}"`);
  } else if (checkable.length < MIN_MUST_HAVES) {
    decision = "needs_human";
    reasons.push(`Only ${checkable.length} must-have requirement${checkable.length === 1 ? "" : "s"} could be checked, fewer than ${MIN_MUST_HAVES}.`);
  } else if (coverage! < SKIP_BELOW) {
    decision = "skip";
    reasons.push(`Below the ${Math.round(SKIP_BELOW * 100)}% skip line.`);
  } else if (missingCredentials.length > 0) {
    decision = "needs_human";
    for (const r of missingCredentials) reasons.push(`Must-have credential with no evidence: "${r.quote}".`);
  } else if (coverage! >= APPLY_AT) {
    decision = "apply";
    reasons.push(`At or above the ${Math.round(APPLY_AT * 100)}% apply line.`);
  } else {
    decision = "needs_human";
    reasons.push(`Between the ${Math.round(SKIP_BELOW * 100)}% skip line and the ${Math.round(APPLY_AT * 100)}% apply line.`);
  }

  return { decision, reasons, coverage, mustHaves: checkable.length, supported: supported.length, gaps, personOnly };
}
