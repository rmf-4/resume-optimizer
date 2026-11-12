// Runs one evaluation case once (AGENT_SPEC.md §5). Each run is scored at both levels from the same packet
// (rule 4): level 2 as prepared, level 3 by applying its stop-or-submit rule.

import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPacket } from "@/lib/agent/packetShape";
import { runDecide } from "@/lib/agent/run";
import { level3StopReason, submitToMockSite } from "@/lib/agent/submission";
import { runTailor } from "@/lib/agent/tailor";
import type { AgentModel } from "@/lib/agent/types";
import { memoryStore } from "@/lib/store";

export type CaseFile = {
  id: string;
  category: string;
  resume: string;
  notes: string | null;
  form: "simple" | "full";
  person_only_questions?: string[];
  modified?: boolean;
  modification?: string | null;
};

export type LoadedCase = CaseFile & { set: "dev" | "locked"; resumeText: string; postingText: string; notesText?: string };

/** Categories whose expected behaviour is about the resume, so they're tailored even when not marked apply. */
export const PREPARE_ANYWAY = new Set(["sparse_resume", "fabrication_bait"]);
/** Trap categories: the decision is fixed by the spec, not by the labels. */
export const TRAPS = new Set(["injection", "scam", "hidden_text"]);

export function loadCase(root: string, set: "dev" | "locked", dir: string): LoadedCase {
  const base = path.join(root, "eval", "cases", set, dir);
  const c = JSON.parse(readFileSync(path.join(base, "case.json"), "utf8")) as CaseFile;
  const notesText = c.notes ? readFileSync(path.join(base, c.notes), "utf8") : undefined;
  return {
    ...c,
    set,
    resumeText: readFileSync(path.join(root, c.resume), "utf8"),
    postingText: readFileSync(path.join(base, "posting.txt"), "utf8"),
    notesText,
  };
}

export type RunRecord = {
  caseId: string;
  category: string;
  set: "dev" | "locked";
  run: number;
  mode: "ai" | "simulated";
  error?: string;
  seconds: number;
  inputTokens: number;
  outputTokens: number;
  decision?: "apply" | "skip" | "needs_human";
  coverage?: number | null;
  reasons?: string[];
  warnings?: { kind: string; input: string; quote: string }[];
  requirements?: { quote: string; priority: string; kind: string; evidence: string[] }[];
  gaps?: string[];
  personOnly?: string[];
  tailored: boolean;
  preparedAnyway: boolean;
  tailoredResume?: string;
  kept?: { original: string; rewrite: string; review?: { text: string; requirement: string }[] }[];
  reverted?: { original: string; rewrite: string; reasons: { type: string; text: string }[] }[];
  requested?: number;
  moved?: number;
  skillLinesReordered?: number;
  echo?: { before: number; after: number; total: number };
  level3: { outcome: "would_submit" | "stops"; reason: string | null };
  /** C2: an unapproved submission of this packet to the mock site must be refused. */
  unapprovedSubmitRefused?: boolean;
};

export async function runCase(c: LoadedCase, model: AgentModel, run: number, usage: { inputTokens: number; outputTokens: number }): Promise<RunRecord> {
  const t0 = Date.now();
  const base = { caseId: c.id, category: c.category, set: c.set, run, mode: model.mode, tailored: false, preparedAnyway: false };
  const done = (r: Omit<RunRecord, "seconds" | "inputTokens" | "outputTokens" | keyof typeof base> & Partial<typeof base>): RunRecord => ({
    ...base,
    ...r,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  const input = { resume: c.resumeText, posting: c.postingText, notes: c.notesText };
  const decided = await runDecide(input, model);
  if (!decided.ok) return done({ error: `${decided.error.code}: ${decided.error.message}`, level3: { outcome: "stops", reason: "the decide step failed" } });
  const d = decided.result;
  const decideFields = {
    decision: d.decision,
    coverage: d.coverage,
    reasons: d.reasons,
    warnings: d.warnings,
    requirements: d.requirements,
    gaps: d.gaps,
    personOnly: d.personOnly,
  };

  // The mock site's full form asks its own questions on top of the posting's person-only ones.
  const formQuestions = c.form === "full" ? (c.person_only_questions ?? []) : [];
  const personOnly = [...new Set([...d.personOnly, ...formQuestions])];

  const prepareAnyway = d.decision !== "apply" && PREPARE_ANYWAY.has(c.category);
  if (d.decision !== "apply" && !prepareAnyway) {
    const stop = level3StopReason({ ...emptyPacket, decision: d.decision, warnings: d.warnings, personOnly });
    return done({ ...decideFields, level3: { outcome: "stops", reason: stop } });
  }

  const t = await runTailor(input, d, model, { prepareAnyway });
  if (!t.ok) {
    return done({ ...decideFields, error: `tailor ${t.error.code}: ${t.error.message}`, level3: { outcome: "stops", reason: "the tailor step failed" } });
  }
  const packet = { ...buildPacket({ postingTitle: c.id, posting: c.postingText, decide: d, tailor: t.result, mode: model.mode }), personOnly };
  const stop = level3StopReason(packet);
  const refused = await submitToMockSite({ store: memoryStore(), packet, answers: {} });

  return done({
    ...decideFields,
    personOnly,
    tailored: true,
    preparedAnyway: prepareAnyway,
    tailoredResume: t.result.tailored,
    kept: t.result.kept.map((k) => ({ original: k.original, rewrite: k.rewrite, review: k.review })),
    reverted: t.result.reverted.map((r) => ({ original: r.original, rewrite: r.rewrite, reasons: r.reasons })),
    requested: t.result.counts.requested,
    moved: t.result.counts.moved,
    skillLinesReordered: t.result.counts.skillLinesReordered,
    echo: { before: t.result.echo.before, after: t.result.echo.after, total: t.result.echo.total },
    level3: { outcome: stop ? "stops" : "would_submit", reason: stop },
    unapprovedSubmitRefused: !refused.ok && refused.code === "approval_required",
  });
}

const emptyPacket = { postingTitle: "", posting: "", resume: "", decision: "apply" as const, coverage: null, warnings: [], flags: 0, personOnly: [], mode: "ai" as const };
