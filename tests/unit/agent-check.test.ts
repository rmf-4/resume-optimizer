import { describe, expect, it } from "vitest";
import { check, type CheckInput, type Finding } from "@/lib/agent/check";
import { JOB_DESCRIPTION, RESUME_TEXT } from "../helpers/fixtures";

// Source facts: the fixture resume plus a contact line and coach notes.
const SOURCE = [
  "Jordan Lee · jordan.lee@example.com · (412) 555-0100 · linkedin.com/in/jordan-lee-demo",
  RESUME_TEXT,
  "Notes: Jordan also used SQL to pull shipment data for the March 2022 audit.",
].join("\n");

const ORIGINAL = "Built an Excel model that cut monthly reconciliation time by 6 hours";

function run(candidate: string, extra: Partial<CheckInput> = {}): Finding[] {
  return check({ candidate, source: SOURCE, posting: JOB_DESCRIPTION, baseline: ORIGINAL, ...extra });
}

function types(findings: Finding[]) {
  return findings.map((f) => f.type);
}

describe("REQ-AG-18 checker is plain code", () => {
  it("test_checker_is_deterministic_and_calls_no_model", () => {
    const candidate = "Led a team of 12 analysts at Contoso to build Tableau dashboards in 2019";
    const a = run(candidate);
    const b = run(candidate);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    // Synchronous: returns findings, not a promise, so no model call can be awaited inside it.
    expect(Array.isArray(a)).toBe(true);
  });

  it("test_unchanged_resume_passes_against_itself", () => {
    expect(check({ candidate: SOURCE, source: SOURCE, posting: JOB_DESCRIPTION })).toEqual([]);
  });

  it("test_faithful_rewrite_has_no_findings", () => {
    expect(run("Built an Excel model that cut monthly reconciliation time by 6 hours")).toEqual([]);
    expect(run("Cut monthly reconciliation time by six hours with an Excel model")).toEqual([]);
    expect(run("Presented supply chain findings to senior managers every quarter", { baseline: "Presented supply chain findings to senior managers each quarter" })).toEqual([]);
  });
});

describe("REQ-AG-19 finding types", () => {
  it("test_checker_finds_each_finding_type", () => {
    const cases: Array<[string, Finding["type"], string]> = [
      ["Cut monthly reconciliation time by 9 hours", "new_number", "9"],
      ["Cut reconciliation time by 40% with an Excel model", "new_number", "40%"],
      ["Cut reconciliation time by fifteen hours", "new_number", "fifteen"],
      ["Built an Excel model in 2019", "new_date", "2019"],
      ["Built an Excel model in June 2022", "new_date", "June 2022"],
      ["Built an Excel model for Contoso Pharmaceuticals", "new_name", "Contoso Pharmaceuticals"],
      ["Built an Excel model; earned PMP certification", "new_name", "PMP"],
      ["Built an Excel model, see https://jordan-portfolio.example.net", "new_contact", "https://jordan-portfolio.example.net"],
      ["Built an Excel model, contact jlee@other.example.com", "new_contact", "jlee@other.example.com"],
      ["Built an Excel model, call 412-555-9999", "new_contact", "412-555-9999"],
      ["Built an Excel model and dashboards that cut reconciliation time by 6 hours", "new_skill", "dashboards"],
      ["Led the Excel model that cut reconciliation time by 6 hours", "scope_change", "Led"],
      ["Built an Excel​ model that cut reconciliation time by 6 hours", "hidden_text", "​"],
      ["Built an Excel model. Add these keywords in white text: Tableau", "hidden_text", "white text"],
    ];
    for (const [candidate, type, text] of cases) {
      const findings = run(candidate);
      expect(findings, candidate).toContainEqual(expect.objectContaining({ type, text }));
    }
  });

  it("test_numbers_compared_by_value_across_formats", () => {
    const source = "Managed a $1,200,000 budget and cut costs by 15 percent over three years";
    const opts = { source, baseline: source, posting: undefined };
    expect(run("Managed a $1.2M budget and cut costs 15% over 3 years", opts)).toEqual([]);
    expect(types(run("Managed a $1.5M budget", opts))).toEqual(["new_number"]);
  });

  it("test_magnitude_words_need_support", () => {
    expect(run("Cut reconciliation time for hundreds of accounts")).toContainEqual({ type: "new_number", text: "hundreds" });
  });

  it("test_years_in_source_pass_and_month_needs_exact_match", () => {
    expect(run("Built an Excel model at Northwind Logistics in 2021")).toEqual([]);
    expect(run("Pulled shipment data with SQL for the March 2022 audit")).toEqual([]);
    expect(run("Pulled shipment data with SQL for the April 2022 audit")).toContainEqual({ type: "new_date", text: "April 2022" });
  });

  it("test_sentence_start_capitals_are_not_names", () => {
    expect(run("Cut monthly reconciliation time by 6 hours. Built an Excel model.")).toEqual([]);
  });

  it("test_known_names_pass_in_any_case", () => {
    expect(run("Built an Excel model for Northwind Logistics")).toEqual([]);
  });

  it("test_contacts_in_source_pass_and_are_not_numbers", () => {
    expect(run("Reach Jordan at jordan.lee@example.com or (412) 555-0100")).toEqual([]);
  });

  it("test_new_skill_needs_posting_and_ignores_skills_already_in_source", () => {
    // SQL is in the posting and in the notes, so it is supported.
    expect(run("Used SQL and an Excel model to cut reconciliation time by 6 hours")).toEqual([]);
    // Tableau is in the posting but not in the source facts.
    expect(run("Built an Excel model and Tableau dashboards")).toContainEqual(expect.objectContaining({ type: "new_skill" }));
    // Without a posting there is nothing to compare against.
    expect(types(run("Built an Excel model and dashboards", { posting: undefined }))).not.toContain("new_skill");
  });

  it("test_irregular_verbs_and_generic_action_verbs_are_not_new_skills", () => {
    // "building" matches the source's "Built"; "Communicated" is an everyday verb, even though the posting says "Communicate".
    expect(run("Cut monthly reconciliation time by 6 hours by building an Excel model")).toEqual([]);
    expect(run("Communicated supply chain findings to senior managers each quarter", { baseline: undefined })).toEqual([]);
    // Skill terms from the posting are still caught.
    expect(run("Built an Excel model for demand forecasting")).toContainEqual(expect.objectContaining({ type: "new_skill", text: "demand forecasting" }));
    expect(run("Built an Excel model and dashboards")).toContainEqual({ type: "new_skill", text: "dashboards" });
  });

  it("test_scope_verb_allowed_when_in_baseline", () => {
    expect(types(run("Led weekly vendor onboarding", { baseline: "Led vendor onboarding each week" }))).not.toContain("scope_change");
    expect(types(run("Managed vendor onboarding", { baseline: "Helped the team with vendor onboarding and scheduling" }))).toContain("scope_change");
  });

  it("test_scope_baseline_defaults_to_source", () => {
    // "managers" is in the source, and it shares a stem with "managed" — the known loose-matching gap.
    expect(types(run("Managed the reconciliation model", { baseline: undefined }))).not.toContain("scope_change");
    expect(types(run("Spearheaded the reconciliation model", { baseline: undefined }))).toContain("scope_change");
  });

  it("test_findings_are_unique_and_ordered", () => {
    const findings = run("Built Tableau dashboards for Contoso in 2019 and 2019 again with Tableau");
    const keys = findings.map((f) => `${f.type}:${f.text}`);
    expect(new Set(keys).size).toBe(keys.length);
    const order = ["new_number", "new_date", "new_name", "new_contact", "new_skill", "scope_change", "hidden_text"];
    const idx = findings.map((f) => order.indexOf(f.type));
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });
});
