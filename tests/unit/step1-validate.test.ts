import { describe, expect, it } from "vitest";
import { STEP1_HEADER } from "@/lib/step1/types";
import { validateStep1 } from "@/lib/step1/validate";
import { findBullets } from "@/lib/text";
import { JOB_DESCRIPTION, RESUME_TEXT } from "../helpers/fixtures";

// Keywords that all appear in JOB_DESCRIPTION.
const GROUNDED = [
  { keyword: "demand forecasting", category: "hard skill" },
  { keyword: "Tableau", category: "tool" },
  { keyword: "SQL", category: "tool" },
  { keyword: "Power BI", category: "tool" },
  { keyword: "vendor management", category: "hard skill" },
  { keyword: "Lean Six Sigma", category: "industry term" },
  { keyword: "stakeholder management", category: "soft skill" },
  { keyword: "inventory optimization", category: "hard skill" },
  { keyword: "SAP", category: "tool" },
  { keyword: "data storytelling", category: "soft skill" },
  { keyword: "contract negotiation", category: "hard skill" },
  { keyword: "Python", category: "tool" },
  { keyword: "continuous improvement", category: "industry term" },
];

const ctx = { resumeText: RESUME_TEXT, jobDescription: JOB_DESCRIPTION, bullets: findBullets(RESUME_TEXT) };

function output(keywordCount: number, extra: object = {}) {
  return {
    keywords: GROUNDED.slice(0, keywordCount),
    weak_bullets: [
      { bullet_id: 1, reason: "passive phrasing", explanation: "Starts with 'Responsible for' and describes a duty, not a result." },
      { bullet_id: 2, reason: "generic", explanation: "Does not say what was onboarded or how much." },
      { bullet_id: 4, reason: "no measurable impact", explanation: "No scale or outcome is given." },
    ],
    ...extra,
  };
}

describe("REQ-GEN-01 / REQ-GEN-03 keyword list", () => {
  it("test_report_has_step1_header", () => {
    const r = validateStep1(output(10), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.header).toBe("Step 1: ATS & Keyword Gap Analysis");
    expect(STEP1_HEADER).toBe("Step 1: ATS & Keyword Gap Analysis");
  });

  it("test_keyword_list_count_category_status_validator", () => {
    expect(validateStep1(output(7), ctx).ok).toBe(false);
    expect(validateStep1(output(13), ctx).ok).toBe(false);
    expect(validateStep1(output(8), ctx).ok).toBe(true);
    expect(validateStep1(output(12), ctx).ok).toBe(true);

    const badCategory = output(9);
    badCategory.keywords = [...badCategory.keywords.slice(0, 8), { keyword: "Python", category: "language" }];
    expect(validateStep1(badCategory, ctx).ok).toBe(false);

    const missingCategory = output(9);
    missingCategory.keywords = [...missingCategory.keywords.slice(0, 8), { keyword: "Python" } as never];
    expect(validateStep1(missingCategory, ctx).ok).toBe(false);

    const r = validateStep1(output(10), ctx);
    if (!r.ok) throw new Error(r.problems.join("; "));
    for (const k of r.report.keywords) {
      expect(["hard skill", "soft skill", "tool", "industry term"]).toContain(k.category);
      expect(["missing", "underrepresented"]).toContain(k.status);
    }
  });

  it("test_duplicate_keywords_are_counted_once", () => {
    const dupes = output(8);
    dupes.keywords = [...dupes.keywords.slice(0, 7), { keyword: "sql", category: "tool" }];
    // 7 distinct keywords after de-duplication -> below the minimum.
    expect(validateStep1(dupes, ctx).ok).toBe(false);
  });
});

describe("REQ-GEN-04 grounding", () => {
  it("test_ungrounded_keywords_removed_and_regenerate_if_under_8", () => {
    const withFake = output(9);
    withFake.keywords = [...withFake.keywords, { keyword: "Kubernetes", category: "tool" }];
    const r = validateStep1(withFake, ctx);
    if (!r.ok) throw new Error(r.problems.join("; "));
    expect(r.report.keywords.map((k) => k.keyword)).not.toContain("Kubernetes");
    expect(r.report.droppedKeywords).toEqual(["Kubernetes"]);
    expect(r.report.keywords).toHaveLength(9);

    const tooFewAfterDrop = output(8);
    tooFewAfterDrop.keywords = [...tooFewAfterDrop.keywords.slice(0, 7), { keyword: "Kubernetes", category: "tool" }];
    expect(validateStep1(tooFewAfterDrop, ctx).ok).toBe(false);
  });
});

describe("REQ-S1-02 status set by code", () => {
  it("test_keyword_status_set_by_code_not_model", () => {
    const r = validateStep1(
      output(8, {
        keywords: [
          ...GROUNDED.slice(0, 7),
          // Excel appears in both the JD and the resume; the model's own label is ignored.
          { keyword: "Excel", category: "tool", status: "missing" },
        ],
      }),
      ctx,
    );
    if (!r.ok) throw new Error(r.problems.join("; "));
    const byName = Object.fromEntries(r.report.keywords.map((k) => [k.keyword, k.status]));
    expect(byName["Excel"]).toBe("underrepresented");
    expect(byName["Tableau"]).toBe("missing");
  });
});

describe("REQ-GEN-05 / REQ-GEN-06 weak bullets", () => {
  it("test_weak_bullets_exactly_three_and_verbatim", () => {
    const r = validateStep1(output(10), ctx);
    if (!r.ok) throw new Error(r.problems.join("; "));
    expect(r.report.weakBullets).toHaveLength(3);
    for (const b of r.report.weakBullets) {
      expect(RESUME_TEXT).toContain(b.quote);
      expect(["generic", "no measurable impact", "passive phrasing"]).toContain(b.reason);
      expect(b.explanation.length).toBeGreaterThan(0);
    }
    expect(r.report.weakBullets[0].quote).toBe("Responsible for weekly inventory reports for the regional warehouse team");
    expect(r.report.bulletShortfall).toBe(0);

    const two = output(10);
    two.weak_bullets = two.weak_bullets.slice(0, 2);
    expect(validateStep1(two, ctx).ok).toBe(false);

    const unknownId = output(10);
    unknownId.weak_bullets[2] = { ...unknownId.weak_bullets[2], bullet_id: 99 };
    expect(validateStep1(unknownId, ctx).ok).toBe(false);

    const dupId = output(10);
    dupId.weak_bullets[2] = { ...dupId.weak_bullets[2], bullet_id: 1 };
    expect(validateStep1(dupId, ctx).ok).toBe(false);

    const badReason = output(10);
    badReason.weak_bullets[0] = { ...badReason.weak_bullets[0], reason: "too long" };
    expect(validateStep1(badReason, ctx).ok).toBe(false);

    const blank = output(10);
    blank.weak_bullets[0] = { ...blank.weak_bullets[0], explanation: "   " };
    expect(validateStep1(blank, ctx).ok).toBe(false);
  });

  it("test_fewer_than_three_bullets_lists_all_and_states_shortfall", () => {
    const resumeText = "Sam Rivera\nWork Experience\n• Managed the front desk\n• Answered customer phone calls";
    const smallCtx = { resumeText, jobDescription: JOB_DESCRIPTION, bullets: findBullets(resumeText) };
    const both = output(8, {
      weak_bullets: [
        { bullet_id: 1, reason: "generic", explanation: "No detail about scale." },
        { bullet_id: 2, reason: "no measurable impact", explanation: "No volume or result." },
      ],
    });
    const r = validateStep1(both, smallCtx);
    if (!r.ok) throw new Error(r.problems.join("; "));
    expect(r.report.weakBullets).toHaveLength(2);
    expect(r.report.bulletsFound).toBe(2);
    expect(r.report.bulletShortfall).toBe(1);

    const onlyOne = output(8, { weak_bullets: both.weak_bullets.slice(0, 1) });
    expect(validateStep1(onlyOne, smallCtx).ok).toBe(false);
  });
});

describe("SEC-LLM-03 output is validated before use", () => {
  it("test_output_schema_validation_before_store", () => {
    expect(validateStep1(null, ctx).ok).toBe(false);
    expect(validateStep1("Step 1: here are some keywords", ctx).ok).toBe(false);
    expect(validateStep1({ keywords: "SQL" }, ctx).ok).toBe(false);
  });
});
