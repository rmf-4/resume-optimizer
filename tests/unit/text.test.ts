import { describe, expect, it } from "vitest";
import { containsPhrase, findBullets, stem } from "@/lib/text";
import { RESUME_TEXT } from "../helpers/fixtures";

describe("stemming and phrase matching (REQ-GEN-04 support)", () => {
  it("test_stemmer_conflates_common_inflections", () => {
    expect(stem("managing")).toBe(stem("managed"));
    expect(stem("manages")).toBe(stem("management"));
    expect(stem("pipelines")).toBe(stem("pipeline"));
    expect(stem("analytics")).toBe(stem("analytical"));
    expect(stem("dashboards")).toBe(stem("dashboard"));
  });

  it("test_contains_phrase_is_case_insensitive_and_stemmed", () => {
    const jd = "Build and maintain Tableau dashboards and SQL data pipelines.";
    expect(containsPhrase(jd, "Data Pipeline")).toBe(true);
    expect(containsPhrase(jd, "tableau dashboard")).toBe(true);
    expect(containsPhrase(jd, "Kubernetes")).toBe(false);
    // Words must be adjacent and in order.
    expect(containsPhrase(jd, "pipelines data")).toBe(false);
  });

  it("test_contains_phrase_keeps_symbol_skills_distinct", () => {
    expect(containsPhrase("Experience with C++ and C#", "C++")).toBe(true);
    expect(containsPhrase("Experience with C#", "C++")).toBe(false);
    expect(containsPhrase("Node.js services", "node.js")).toBe(true);
  });
});

describe("bullet detection (REQ-GEN-05/06 support)", () => {
  it("test_find_bullets_returns_marker_lines_verbatim_without_marker", () => {
    const bullets = findBullets(RESUME_TEXT);
    expect(bullets).toHaveLength(5);
    expect(bullets[0]).toEqual({ id: 1, text: "Responsible for weekly inventory reports for the regional warehouse team" });
    for (const b of bullets) expect(RESUME_TEXT).toContain(b.text);
  });

  it("test_find_bullets_accepts_dash_and_star_markers", () => {
    const bullets = findBullets("- Led a team of four\n* Shipped the billing rewrite\nNot a bullet line");
    expect(bullets.map((b) => b.text)).toEqual(["Led a team of four", "Shipped the billing rewrite"]);
  });

  it("test_find_bullets_handles_marker_on_its_own_line", () => {
    const text = "EXPERIENCE\n●\nLed a team of four analysts\n●\nShipped the billing rewrite\nSKILLS";
    expect(findBullets(text).map((b) => b.text)).toEqual(["Led a team of four analysts", "Shipped the billing rewrite"]);
  });

  it("test_find_bullets_falls_back_to_sentence_lines_when_no_markers", () => {
    const text = "Jane Smith\nSoftware Engineer\nDesigned the payments service used by every checkout flow\nMentored two junior engineers through their first launches";
    expect(findBullets(text).map((b) => b.text)).toEqual([
      "Designed the payments service used by every checkout flow",
      "Mentored two junior engineers through their first launches",
    ]);
  });
});
