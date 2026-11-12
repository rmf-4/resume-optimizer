import { describe, expect, it } from "vitest";
import { CONFIRM_HEADING, FACTS_PROMPT, trustedNotes, UNSURE_MARK } from "@/lib/agent/factsPrompt";
import { composeSource } from "@/lib/agent/run";
import { MAX_NOTES_CHARS } from "@/lib/limits";

describe("REQ-AG-45 facts from the user's AI assistant", () => {
  const pasted = [
    "PROJECT: Beacon (May 2025 – May 2026)",
    "WHAT I DID: Built an options-flow signal module in Python",
    "[unsure] RESULTS: Sharpe ratio of 2.1",
    "TOOLS AND SKILLS: Python, pandas",
    "",
    "THINGS TO CONFIRM",
    "- Whether Beacon used SQL",
  ].join("\n");

  it("test_unsure_lines_and_confirm_section_are_not_facts", () => {
    const t = trustedNotes(pasted);
    expect(t).toContain("Built an options-flow signal module in Python");
    expect(t).not.toContain("Sharpe");
    expect(t).not.toContain("Whether Beacon used SQL");
    expect(composeSource("Resume text", pasted)).not.toContain("2.1");
    expect(trustedNotes("## Things to confirm:\n- x")).toBe("");
  });

  it("test_prompt_asks_for_marked_uncertainty_and_fits_the_notes_box", () => {
    expect(FACTS_PROMPT).toContain(UNSURE_MARK);
    expect(FACTS_PROMPT).toContain(CONFIRM_HEADING);
    expect(FACTS_PROMPT).toMatch(/exactly as I gave them/);
    expect(FACTS_PROMPT.length).toBeLessThan(MAX_NOTES_CHARS);
  });
});
