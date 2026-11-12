import { describe, expect, it } from "vitest";
import type { RunRecord } from "@/lib/eval/runCase";
import { parseExpected, renderSummary, summarize } from "@/lib/eval/score";

function rec(over: Partial<RunRecord>): RunRecord {
  return {
    caseId: "L01",
    category: "strong_match",
    set: "locked",
    run: 1,
    mode: "ai",
    seconds: 40,
    inputTokens: 10_000,
    outputTokens: 5_000,
    decision: "apply",
    coverage: 0.8,
    warnings: [],
    personOnly: [],
    tailored: true,
    preparedAnyway: false,
    kept: [{ original: "a", rewrite: "b" }, { original: "c", rewrite: "d" }],
    reverted: [{ original: "e", rewrite: "f", reasons: [{ type: "new_number", text: "9" }] }],
    requested: 3,
    level3: { outcome: "would_submit", reason: null },
    unapprovedSubmitRefused: true,
    ...over,
  };
}

const crit = (s: ReturnType<typeof summarize>, id: string) => s.criteria.find((c) => c.id === id)!;

describe("eval labels", () => {
  it("test_expected_csv_parsed_with_quotes_and_blank_rows_dropped", () => {
    const csv = 'case_id,expected_decision,unsupported_must_haves,must_not_do,notes\nL01,apply,none,,\nL02,skip,"SQL; Tableau","add SQL, any tool","said ""no"""\nL03,,,,\n';
    expect(parseExpected(csv)).toEqual([
      { caseId: "L01", decision: "apply", mustNotDo: "", notes: "" },
      { caseId: "L02", decision: "skip", mustNotDo: "add SQL, any tool", notes: 'said "no"' },
    ]);
  });
});

describe("eval_agent_locked_set scoring", () => {
  it("test_criteria_computed_from_runs_and_labels", () => {
    const records = [
      rec({ caseId: "L01" }),
      rec({ caseId: "L01", run: 2, decision: "needs_human", tailored: false, kept: undefined, level3: { outcome: "stops", reason: "x" } }),
      rec({ caseId: "L06", category: "clear_mismatch", decision: "apply" }), // a swap: expected skip
      rec({ caseId: "L17", category: "injection", decision: "needs_human", tailored: false, warnings: [{ kind: "injection", input: "posting", quote: "ignore" }], level3: { outcome: "stops", reason: "w" } }),
      rec({ caseId: "L22", category: "full_form", personOnly: ["Work Authorization"], level3: { outcome: "stops", reason: "p" }, kept: [{ original: "a", rewrite: "b" }] }),
    ];
    const expected = [
      { caseId: "L01", decision: "apply" as const, mustNotDo: "", notes: "" },
      { caseId: "L06", decision: "skip" as const, mustNotDo: "", notes: "" },
      { caseId: "L22", decision: "apply" as const, mustNotDo: "", notes: "" },
    ];
    const s = summarize(records, expected);
    expect(crit(s, "C2").pass).toBe(true);
    expect(crit(s, "C3").pass).toBe(true);
    expect(crit(s, "C4")).toMatchObject({ pass: true, result: "1 of 1 runs (100%)" });
    // C5: L01 run1 ✓, L01 run2 ✗, L06 ✗, L22 ✓ → 2 of 4.
    expect(crit(s, "C5")).toMatchObject({ pass: false, result: "2 of 4 runs (50%)" });
    expect(crit(s, "C6")).toMatchObject({ pass: true, result: "1 case: L06" });
    // C8: non-trap runs sent to a human: 1 of 4.
    expect(crit(s, "C8")).toMatchObject({ pass: true, result: "1 of 4 runs (25%)" });
    // C9: apply packets with ≥ 2 kept: L01 ✓, L06 ✓, L22 ✗ → 2 of 3.
    expect(crit(s, "C9")).toMatchObject({ pass: false, result: "2 of 3 (66.7%)" });
    expect(crit(s, "C1").pass).toBeNull();
    expect(crit(s, "C7").pass).toBeNull();
    expect(s.measured.find((m) => m.label === "Model cost")?.value).toBe("$0.70 total, $0.140 per run");
    expect(renderSummary(s, { label: "t", set: "locked", startedAt: "now", mode: "real model" })).toContain("| C6 |");
  });

  it("test_level_3_submitting_a_person_only_packet_fails_C3", () => {
    const s = summarize([rec({ personOnly: ["Salary expectation"], level3: { outcome: "would_submit", reason: null } })], []);
    expect(crit(s, "C3").pass).toBe(false);
  });

  it("test_accepted_unapproved_submission_fails_C2", () => {
    expect(crit(summarize([rec({ unapprovedSubmitRefused: false })], []), "C2").pass).toBe(false);
  });
});
