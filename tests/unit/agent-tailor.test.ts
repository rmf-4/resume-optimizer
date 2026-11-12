import { describe, expect, it } from "vitest";
import { check } from "@/lib/agent/check";
import { runDecide, type DecideResult } from "@/lib/agent/run";
import { simulatedModel } from "@/lib/agent/simulated";
import { applyRewrites, assembleResume, bulletEntries, buildTailorPrompt, echoReport, findSkillLines, isTrivialChange, matchTypography, runTailor } from "@/lib/agent/tailor";
import { SAMPLE_RESUME } from "@/lib/agent/sample";
import type { AgentModel } from "@/lib/agent/types";
import type { ModelResult } from "@/lib/step1/types";
import { findBullets } from "@/lib/text";
import { JOB_DESCRIPTION, RESUME_LINES, RESUME_TEXT } from "../helpers/fixtures";

// Bullet ids in RESUME_TEXT:
// 1 Responsible for weekly inventory reports...   2 Helped the team with vendor onboarding...
// 3 Built an Excel model that cut...             4 Worked on process documentation...
// 5 Presented supply chain findings...
const bullets = findBullets(RESUME_TEXT);
const base = { resume: RESUME_TEXT, posting: JOB_DESCRIPTION, bullets, keywords: [] as string[] };

describe("REQ-AG-14 / REQ-AG-15 assembly", () => {
  it("test_rewrites_applied_by_id_and_others_unchanged", () => {
    const out = assembleResume(RESUME_TEXT, bullets, new Map([[3, "Cut monthly reconciliation time by 6 hours with an Excel model"]]));
    const lines = out.split("\n");
    expect(lines[6]).toBe("• Cut monthly reconciliation time by 6 hours with an Excel model");
    lines.forEach((line, i) => {
      if (i !== 6) expect(line).toBe(RESUME_LINES[i]);
    });
  });

  it("test_non_bullet_lines_identical_after_assembly", () => {
    const resume = ["Sam Doe", "  - Led weekly standups for the data team", "Acme | Analyst | 2020 – 2022", "* Built dashboards in Excel"].join("\n");
    const b = findBullets(resume);
    const out = assembleResume(resume, b, new Map([[1, "Ran weekly standups for the data team"], [2, "Built Excel dashboards"]]));
    expect(out).toBe(["Sam Doe", "  - Ran weekly standups for the data team", "Acme | Analyst | 2020 – 2022", "* Built Excel dashboards"].join("\n"));
  });
});

describe("REQ-AG-14 lead bullet per entry", () => {
  const twoRoles = [
    "Sam Doe",
    "EXPERIENCE",
    "Acme | Analyst | 2020 – 2022",
    "• Built dashboards in Excel",
    "• Wrote SQL queries for weekly reports",
    "  • Presented findings to managers",
    "Beta Co | Intern | 2019",
    "- Filed invoices",
    "- Reconciled vendor statements in Excel",
  ].join("\n");
  const b = findBullets(twoRoles);

  it("test_lead_bullet_moves_to_top_of_its_entry_only", () => {
    const r = applyRewrites({ resume: twoRoles, posting: JOB_DESCRIPTION, bullets: b, keywords: [], raw: { rewrites: [], lead_bullet_ids: [2, 5] } });
    expect(r.tailored.split("\n")).toEqual([
      "Sam Doe",
      "EXPERIENCE",
      "Acme | Analyst | 2020 – 2022",
      "• Wrote SQL queries for weekly reports",
      "• Built dashboards in Excel",
      "  • Presented findings to managers",
      "Beta Co | Intern | 2019",
      "- Reconciled vendor statements in Excel",
      "- Filed invoices",
    ]);
    expect(r.moved.map((m) => m.bulletId)).toEqual([2, 5]);
    expect(r.counts.moved).toBe(2);
  });

  it("test_invalid_or_duplicate_leads_are_ignored", () => {
    // 1 is already first; 99 doesn't exist; 3 is a second lead for the same entry as 2.
    const r = applyRewrites({ resume: twoRoles, posting: JOB_DESCRIPTION, bullets: b, keywords: [], raw: { rewrites: [], lead_bullet_ids: [1, 99, 2, 3] } });
    expect(r.moved.map((m) => m.bulletId)).toEqual([2]);
  });

  it("test_moved_bullet_carries_its_rewrite", () => {
    const r = applyRewrites({
      resume: twoRoles,
      posting: JOB_DESCRIPTION,
      bullets: b,
      keywords: [],
      raw: { rewrites: [{ bullet_id: 2, text: "Automated weekly reports with SQL queries" }], lead_bullet_ids: [2] },
    });
    expect(r.tailored.split("\n")[3]).toBe("• Automated weekly reports with SQL queries");
    expect(r.tailored.split("\n")[4]).toBe("• Built dashboards in Excel");
  });

  it("test_bullets_carry_their_entry_context", () => {
    const entries = bulletEntries(twoRoles, b);
    expect(entries.get(1)).toBe("Sam Doe | EXPERIENCE | Acme | Analyst | 2020 – 2022");
    expect(entries.get(5)).toBe("Beta Co | Intern | 2019");
  });
});

describe("REQ-AG-15 skills lines", () => {
  const sampleBullets = findBullets(SAMPLE_RESUME);

  it("test_skill_lines_found_with_items_kept_whole", () => {
    const lines = findSkillLines(SAMPLE_RESUME);
    expect(lines.map((l) => l.label)).toEqual(["Technical", "Operations", "Interests"]);
    expect(lines[0].items).toEqual(["Excel (pivot tables, lookups)", "SQL", "Python (pandas)", "PowerPoint"]);
    const withPeriod = findSkillLines("Name\nSKILLS\nTechnical: Python (numpy, pytest), SQL, Excel.");
    expect(withPeriod[0]).toMatchObject({ items: ["Python (numpy, pytest)", "SQL", "Excel"], suffix: "." });
  });

  it("test_skill_line_reordered_with_same_items_only", () => {
    const r = applyRewrites({
      resume: SAMPLE_RESUME,
      posting: JOB_DESCRIPTION,
      bullets: sampleBullets,
      keywords: [],
      raw: { rewrites: [], lead_bullet_ids: [], skill_line_orders: [{ line_id: 1, order: [2, 1, 3, 4] }] },
    });
    expect(r.tailored).toContain("Technical: SQL, Excel (pivot tables, lookups), Python (pandas), PowerPoint");
    expect(r.skillsReordered).toEqual([
      {
        lineId: 1,
        label: "Technical",
        before: "Technical: Excel (pivot tables, lookups), SQL, Python (pandas), PowerPoint",
        after: "Technical: SQL, Excel (pivot tables, lookups), Python (pandas), PowerPoint",
      },
    ]);
    // Every other line is untouched.
    const a = SAMPLE_RESUME.split("\n");
    r.tailored.split("\n").forEach((line, i) => {
      if (!line.startsWith("Technical:")) expect(line).toBe(a[i]);
    });
  });

  it("test_bad_skill_orders_ignored", () => {
    const orders = [
      { line_id: 1, order: [1, 1, 3, 4] }, // repeats an item
      { line_id: 2, order: [2, 1, 3] }, // drops an item
      { line_id: 3, order: [1, 2, 3, 4] }, // no change
      { line_id: 9, order: [2, 1] }, // no such line
    ];
    const r = applyRewrites({ resume: SAMPLE_RESUME, posting: JOB_DESCRIPTION, bullets: sampleBullets, keywords: [], raw: { rewrites: [], skill_line_orders: orders } });
    expect(r.tailored).toBe(SAMPLE_RESUME);
    expect(r.counts.skillLinesReordered).toBe(0);
  });
});

describe("posting words tied to evidence", () => {
  const met = [
    { quote: "Strong stakeholder management and cross-functional collaboration skills", evidence: ["Presented supply chain findings to senior managers each quarter"], keyTerms: ["stakeholder management"] },
  ];

  it("test_met_requirement_wording_off_its_evidence_bullet_is_flagged_for_review", () => {
    const raw = {
      rewrites: [
        { bullet_id: 5, text: "Presented supply chain findings to senior managers each quarter, practicing stakeholder management" },
        { bullet_id: 3, text: "Built an Excel model with stakeholder management that cut monthly reconciliation time by 6 hours" },
      ],
    };
    const r = applyRewrites({ ...base, gaps: [], met, raw });
    expect(r.kept.map((k) => k.bulletId)).toEqual([3, 5]);
    // On its evidence bullet: no flag. On another bullet: kept, but the coach must confirm it.
    expect(r.kept.find((k) => k.bulletId === 5)?.review).toBeUndefined();
    expect(r.kept.find((k) => k.bulletId === 3)?.review).toEqual([{ text: "stakeholder", requirement: met[0].quote }]);
    expect(r.counts.flaggedForReview).toBe(1);
  });

  it("test_first_person_rewrite_thrown_out", () => {
    const r = applyRewrites({ ...base, gaps: [], met, raw: { rewrites: [{ bullet_id: 5, text: "Shared my supply chain findings with senior managers each quarter" }] } });
    expect(r.reverted[0].reasons).toContainEqual({ type: "first_person", text: "my" });
  });
});

describe("REQ-AG-23 posting-language coverage", () => {
  it("test_echo_counts_key_terms", () => {
    const reqs = [{ quote: "Some experience and familiarity with programming or data analysis, either through side projects or coursework", keyTerms: ["data analysis", "programming"] }];
    const e = echoReport("• Analyzed sales trends", "• Applied data analysis to sales trends", reqs);
    expect([e.before, e.after, e.total]).toEqual([0, 1, 1]);
  });

  it("test_echo_report_counts_met_requirements_in_posting_words", () => {
    const supported = ["Advanced SQL and Excel", "Experience with demand forecasting"];
    const before = "• Built an Excel model\n• Wrote queries";
    const after = "• Built an Excel model\n• Wrote SQL queries for demand forecasting";
    const e = echoReport(before, after, supported);
    expect(e.total).toBe(2);
    expect(e.before).toBe(0);
    expect(e.after).toBe(2);
    expect(e.requirements[0]).toEqual({ quote: "Advanced SQL and Excel", before: false, after: true });
  });
});

describe("REQ-AG-16 / REQ-AG-17 / REQ-AG-20 guards", () => {
  const raw = {
    rewrites: [
      { bullet_id: 1, text: "Prepared weekly inventory reports for the regional warehouse team" },
      { bullet_id: 2, text: "Helped onboard vendors and set schedules" },
      { bullet_id: 3, text: "Cut monthly reconciliation time by 6 hours with an Excel model" },
      { bullet_id: 4, text: "Documented shipping and receiving processes in Tableau" },
      { bullet_id: 5, text: "Presented supply chain findings to senior managers each quarter, saving [X] hours" },
      { bullet_id: 9, text: "Invented a bullet" },
    ],
  };

  it("test_finding_reverts_bullet_and_records_it", () => {
    const r = applyRewrites({ ...base, raw });
    expect(r.kept.map((k) => k.bulletId)).toEqual([1, 3]);
    const tableau = r.reverted.find((x) => x.bulletId === 4)!;
    expect(tableau.rewrite).toBe("Documented shipping and receiving processes in Tableau");
    expect(tableau.reasons.map((x) => x.type)).toContain("new_name");
    expect(r.tailored).toContain("• Worked on process documentation for shipping and receiving");
    expect(r.ignored).toEqual([9]);
  });

  it("test_banned_phrase_and_keyword_cap_revert_rewrite", () => {
    const r = applyRewrites({ ...base, raw });
    expect(r.reverted.find((x) => x.bulletId === 2)?.reasons).toContainEqual({ type: "banned_opening", text: "Helped" });

    const notes = "Jordan used Excel for every report and process document.";
    const capped = applyRewrites({
      ...base,
      notes,
      keywords: ["Excel"],
      raw: {
        rewrites: [
          { bullet_id: 1, text: "Prepared weekly inventory reports in Excel for the regional warehouse team" },
          { bullet_id: 3, text: "Cut monthly reconciliation time by 6 hours with an Excel model" },
          { bullet_id: 4, text: "Documented shipping and receiving processes in Excel" },
        ],
      },
    });
    expect(capped.kept.map((k) => k.bulletId)).toEqual([1, 3]);
    expect(capped.reverted[0]).toMatchObject({ bulletId: 4, reasons: [{ type: "keyword_overuse", text: "Excel" }] });
  });

  it("test_no_placeholders_and_numberless_bullets_listed", () => {
    const r = applyRewrites({ ...base, raw });
    expect(r.reverted.find((x) => x.bulletId === 5)?.reasons).toContainEqual({ type: "placeholder", text: "[X]" });
    expect(r.tailored).not.toMatch(/\[[^\]]*\]/);
    expect(r.strongerWithNumber).toEqual([
      "Prepared weekly inventory reports for the regional warehouse team",
      "Helped the team with vendor onboarding and scheduling",
      "Worked on process documentation for shipping and receiving",
      "Presented supply chain findings to senior managers each quarter",
    ]);
  });

  it("test_packet_blocked_until_assembled_resume_passes", () => {
    const r = applyRewrites({ ...base, raw });
    expect(check({ candidate: r.tailored, source: RESUME_TEXT, posting: JOB_DESCRIPTION })).toEqual([]);
    // If the whole resume still fails, the offending rewrites are reverted until it passes.
    let calls = 0;
    const strict = (input: Parameters<typeof check>[0]) => {
      if (input.candidate.includes("Prepared weekly") && input.candidate.includes("Excel model") && input.candidate.length > 200) {
        calls++;
        return [{ type: "new_skill" as const, text: "Prepared weekly" }];
      }
      return [];
    };
    const blocked = applyRewrites({ ...base, raw, checkFn: strict });
    expect(calls).toBeGreaterThan(0);
    expect(blocked.kept.map((k) => k.bulletId)).not.toContain(1);
    expect(blocked.kept.map((k) => k.bulletId)).toContain(3);
    expect(blocked.reverted.find((x) => x.bulletId === 1)?.reasons).toContainEqual({ type: "assembled_check", text: "Prepared weekly" });
  });

  it("test_run_counts_requested_kept_and_reverted", () => {
    const r = applyRewrites({ ...base, raw });
    expect(r.counts.requested).toBe(5);
    expect(r.counts.kept).toBe(2);
    expect(r.counts.reverted).toBe(3);
    expect(r.counts.revertsByType.banned_opening).toBe(1);
    expect(r.counts.revertsByType.placeholder).toBe(1);
    expect(r.counts.revertsByType.new_name).toBe(1);
  });

  it("test_unchanged_or_empty_rewrites_are_not_counted", () => {
    const r = applyRewrites({ ...base, raw: { rewrites: [{ bullet_id: 3, text: bullets[2].text }, { bullet_id: 1, text: "  " }] } });
    expect(r.counts.requested).toBe(0);
    expect(r.tailored).toBe(RESUME_TEXT);
  });
});

describe("REQ-AG-13 tailor run", () => {
  const input = { resume: RESUME_TEXT, notes: "Jordan used SQL for the March 2022 audit.", posting: JOB_DESCRIPTION };

  async function decided(): Promise<DecideResult> {
    const out = await runDecide(input, simulatedModel);
    if (!out.ok) throw new Error("decide failed");
    return out.result;
  }

  function stub(result: ModelResult): AgentModel & { tailorCalls: number; lastUser: string } {
    const m = {
      mode: "ai" as const,
      tailorCalls: 0,
      lastUser: "",
      async decide(): Promise<ModelResult> {
        return { type: "output", data: { requirements: [] } };
      },
      async tailor(prompt: { system: string; user: string }): Promise<ModelResult> {
        // (returns whatever the test gave it)
        m.tailorCalls++;
        m.lastUser = prompt.user;
        return result;
      },
      async interview(): Promise<ModelResult> {
        return { type: "output", data: { questions: [] } };
      },
      async improve(): Promise<ModelResult> {
        return { type: "output", data: { rewrites: [], new_bullets: [], new_entries: [] } };
      },
    };
    return m;
  }

  it("test_no_tailoring_on_skip_or_needs_human_without_override", async () => {
    const d = { ...(await decided()), decision: "skip" as const };
    const model = stub({ type: "output", data: { rewrites: [], lead_bullet_ids: [] } });
    const out = await runTailor(input, d, model);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("not_apply");
    expect(model.tailorCalls).toBe(0);

    const anyway = await runTailor(input, d, model, { prepareAnyway: true });
    expect(anyway.ok).toBe(true);
    expect(model.tailorCalls).toBe(1);
  });

  it("test_tailor_prompt_lists_bullets_by_id_and_gaps", () => {
    const p = buildTailorPrompt({
      source: "Jordan · [email]\n• Built an Excel model",
      posting: "Needs SQL",
      bullets: [{ id: 1, text: "Built an Excel model", entry: "Northwind | Analyst" }],
      supported: ["Excel"],
      gaps: ["Tableau dashboards"],
    });
    expect(p.user).toContain('<entry context="Northwind | Analyst">\n<bullet id="1">Built an Excel model</bullet>\n</entry>');
    expect(p.user).toContain("Tableau dashboards");
    expect(p.user).not.toContain("@");
  });

  it("test_simulated_tailor_runs_end_to_end", async () => {
    const d = { ...(await decided()), decision: "apply" as const };
    const out = await runTailor(input, d, simulatedModel);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.mode).toBe("simulated");
    expect(check({ candidate: out.result.tailored, source: `${RESUME_TEXT}\n\nCoach notes:\n${input.notes}`, posting: JOB_DESCRIPTION })).toEqual([]);
  });
});

describe("rewrite quality filters", () => {
  it("test_cosmetic_rewrites_are_dropped", () => {
    const original = "Designed and deployed Beacon, an autonomous trading system, and retired the strategy rather than deploying capital into a degrading edge.";
    expect(isTrivialChange(original, "Designed and deployed Beacon, an autonomous trading system and retired the strategy instead of deploying capital into a degrading edge.", [])).toBe(true);
    // Adding a posting keyword is never trivial.
    expect(isTrivialChange("Analyzed sales trends on eBay", "Applied data analysis to sales trends on eBay", ["data analysis"])).toBe(false);
    // A real reframe is kept.
    expect(isTrivialChange(original, "Retired Beacon, an autonomous trading system, after live performance attribution showed alpha decay from signal crowding.", [])).toBe(false);
  });

  it("test_rewrites_keep_typographic_apostrophes", () => {
    expect(matchTypography("Lead Tepper’s required sequence", "Lead Tepper's required sequence for guests' days")).toBe("Lead Tepper’s required sequence for guests' days");
  });
});
