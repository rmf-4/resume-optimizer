import { describe, expect, it } from "vitest";
import { check } from "@/lib/agent/check";
import { runDecide, type DecideResult } from "@/lib/agent/run";
import { simulatedModel } from "@/lib/agent/simulated";
import { applyRewrites, assembleResume, buildTailorPrompt, runTailor } from "@/lib/agent/tailor";
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
        m.tailorCalls++;
        m.lastUser = prompt.user;
        return result;
      },
    };
    return m;
  }

  it("test_no_tailoring_on_skip_or_needs_human_without_override", async () => {
    const d = { ...(await decided()), decision: "skip" as const };
    const model = stub({ type: "output", data: { rewrites: [] } });
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
      bullets: [{ id: 1, text: "Built an Excel model" }],
      supported: ["Excel"],
      gaps: ["Tableau dashboards"],
    });
    expect(p.user).toContain('<bullet id="1">Built an Excel model</bullet>');
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
