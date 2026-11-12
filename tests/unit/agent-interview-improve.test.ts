import { describe, expect, it } from "vitest";
import { applyImprovements, runImprove } from "@/lib/agent/improve";
import { answersToNotes, runInterview, validateInterview } from "@/lib/agent/interview";
import { SAMPLE_RESUME } from "@/lib/agent/sample";
import { simulatedModel } from "@/lib/agent/simulated";
import { findBullets } from "@/lib/text";

const bullets = findBullets(SAMPLE_RESUME);
// Bullet 2 in the sample: "Built an Excel model that cut monthly reconciliation time by 6 hours"
const notes = answersToNotes([
  { question: "How many carriers did the vendor onboarding cover?", answer: "14 carriers, and I built the onboarding checklist in Excel." },
  { question: "Did you present the findings yourself?", answer: "" },
]);

describe("REQ-AG-46 interview", () => {
  it("test_questions_validated_capped_and_deduplicated", () => {
    const q = (question: string) => ({ topic: "Northwind Logistics", question, kind: "number" });
    const raw = { questions: [q("How many SKUs did the cycle count cover?"), q("How many SKUs did the cycle count cover?"), q("Why?"), ...Array.from({ length: 12 }, (_, i) => q(`Question number ${i} about the role?`))] };
    const out = validateInterview(raw)!;
    expect(out.length).toBe(10);
    expect(out[0]).toEqual({ id: 1, topic: "Northwind Logistics", question: "How many SKUs did the cycle count cover?", kind: "number" });
    expect(out.filter((x) => x.question.startsWith("How many SKUs"))).toHaveLength(1);
    expect(validateInterview({ questions: [{ topic: "x", question: "Is this fine?", kind: "guess" }] })).toBeNull();
  });

  it("test_answers_become_notes_and_skipped_ones_are_left_out", () => {
    expect(notes).toBe("Interview answers (from the client):\nQ: How many carriers did the vendor onboarding cover?\nA: 14 carriers, and I built the onboarding checklist in Excel.");
    expect(answersToNotes([{ question: "Q?", answer: "  " }])).toBe("");
  });

  it("test_simulated_interview_runs_without_a_resume_upload", async () => {
    const out = await runInterview({ resume: SAMPLE_RESUME }, simulatedModel);
    expect(out.ok && out.mode).toBe("simulated");
    expect(out.ok && out.questions.length).toBeGreaterThan(0);
  });
});

describe("REQ-AG-47 master resume", () => {
  it("test_supported_new_bullet_added_after_its_anchor_with_its_marker", () => {
    const r = applyImprovements({
      resume: SAMPLE_RESUME,
      notes,
      bullets,
      raw: { rewrites: [], new_bullets: [{ after_bullet_id: 4, text: "Built the Excel onboarding checklist used for 14 new carriers" }], new_entries: [] },
    });
    const lines = r.master.split("\n");
    const at = lines.findIndex((l) => l.includes("vendor onboarding and scheduling for 14 new carriers"));
    expect(lines[at + 1]).toBe("• Built the Excel onboarding checklist used for 14 new carriers");
    expect(r.counts.bulletsAdded).toBe(1);
    // Every original line is still there.
    for (const l of SAMPLE_RESUME.split("\n")) expect(lines).toContain(l);
  });

  it("test_unsupported_additions_rejected_with_reasons", () => {
    const r = applyImprovements({
      resume: SAMPLE_RESUME,
      notes,
      bullets,
      raw: {
        rewrites: [],
        new_bullets: [
          { after_bullet_id: 4, text: "Led onboarding of 45 carriers using Salesforce" },
          { after_bullet_id: 4, text: "I personally ran the onboarding checklist" },
        ],
        new_entries: [{ section: "PROJECTS", title: "Freight Pricing Model | Python, Tableau", bullets: ["Priced 500 lanes with a Tableau dashboard"] }],
      },
    });
    expect(r.master).toBe(SAMPLE_RESUME);
    expect(r.counts.bulletsAdded + r.counts.entriesAdded).toBe(0);
    const reasons = r.rejected.flatMap((x) => x.reasons.map((y) => y.type));
    expect(reasons).toEqual(expect.arrayContaining(["new_number", "new_name", "scope_change", "first_person"]));
  });

  it("test_new_entry_from_notes_added_at_end_of_its_section", () => {
    const projectNotes = `${notes}\nPROJECT: Carrier Scorecard | Excel\nWHAT I DID: Built an Excel scorecard ranking 14 carriers on on-time delivery`;
    const r = applyImprovements({
      resume: SAMPLE_RESUME,
      notes: projectNotes,
      bullets,
      raw: { rewrites: [], new_bullets: [], new_entries: [{ section: "PROJECTS", title: "Carrier Scorecard | Excel", bullets: ["Built an Excel scorecard ranking 14 carriers on on-time delivery"] }] },
    });
    const lines = r.master.split("\n");
    const title = lines.indexOf("Carrier Scorecard | Excel");
    expect(title).toBeGreaterThan(lines.indexOf("PROJECTS"));
    expect(lines[title + 1]).toBe("• Built an Excel scorecard ranking 14 carriers on on-time delivery");
    expect(lines[title + 2]).toBe("LEADERSHIP & ACTIVITIES");
    expect(r.addedEntries).toHaveLength(1);
  });

  it("test_simulated_master_resume_keeps_every_fact", async () => {
    const out = await runImprove({ resume: SAMPLE_RESUME, notes }, simulatedModel);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.mode).toBe("simulated");
    expect(out.result.master).toContain("Northwind Logistics Pittsburgh, PA");
  });
});
