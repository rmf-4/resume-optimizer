import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ExportError, exportDocx, exportPdf, TEMPLATES } from "@/lib/agent/export";
import { SAMPLE_RESUME } from "@/lib/agent/sample";
import { parseResume, splitRight } from "@/lib/agent/structure";
import { extractDocx } from "@/lib/extract/docx";
import { extractPdf } from "@/lib/extract/pdf";

/** Words in order, ignoring case (templates restyle headings), bullet glyphs, tabs and line breaks. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(^|\s)[•\-–](?=\s)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

describe("REQ-AG-41 structure", () => {
  it("test_right_column_split_from_extracted_lines", () => {
    expect(splitRight("Carnegie Mellon University – Tepper School of Business Pittsburgh, PA")).toEqual({
      left: "Carnegie Mellon University – Tepper School of Business",
      right: "Pittsburgh, PA",
      kind: "location",
    });
    expect(splitRight("Acme Capital New York, NY")?.right).toBe("New York, NY");
    expect(splitRight("Supply Chain Intern May 2019 – August 2019")?.right).toBe("May 2019 – August 2019");
    expect(splitRight("B.S. in Business Administration; Minor in Statistics Expected May 2028")?.right).toBe("Expected May 2028");
    expect(splitRight("Analyst\tJune 2021 – Present")?.right).toBe("June 2021 – Present");
    expect(splitRight("Dean’s List (Fall 2025, Spring 2026)")).toBeNull();
    expect(splitRight("Poker AI & Game-Theory Solvers | Python, CFR/MCCFR")).toBeNull();
  });

  it("test_resume_parsed_into_sections_entries_and_bullets", () => {
    const blocks = parseResume(SAMPLE_RESUME);
    expect(blocks[0]).toEqual({ kind: "name", text: "Jordan Lee" });
    expect(blocks[1].kind).toBe("contact");
    expect(blocks.filter((b) => b.kind === "heading").map((b) => (b as { text: string }).text)).toEqual([
      "EDUCATION",
      "EXPERIENCE",
      "PROJECTS",
      "LEADERSHIP & ACTIVITIES",
      "SKILLS & INTERESTS",
    ]);
    expect(blocks).toContainEqual({ kind: "entry", level: "primary", left: "Northwind Logistics", right: "Pittsburgh, PA" });
    expect(blocks).toContainEqual({ kind: "entry", level: "secondary", left: "Operations Analyst", right: "June 2021 – Present" });
    expect(blocks).toContainEqual({ kind: "entry", level: "primary", left: "Inventory Forecasting Capstone | Python, Excel", right: "" });
    expect(blocks).toContainEqual({ kind: "labeled", label: "Certifications", text: "APICS CPIM Part 1 (2022)" });
    expect(blocks.filter((b) => b.kind === "bullet")).toHaveLength(14);
  });
});

describe("REQ-AG-41 / REQ-AG-42 templates", () => {
  it.each(TEMPLATES)("test_%s_fits_one_page_and_round_trips", async (template) => {
    const pdfBytes = await exportPdf(SAMPLE_RESUME, template);
    expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBe(1);
    const pdf = await extractPdf(pdfBytes);
    expect(pdf.hiddenText).toEqual([]);
    expect(words(pdf.text)).toEqual(words(SAMPLE_RESUME));

    const docx = extractDocx(await exportDocx(SAMPLE_RESUME, template));
    expect(docx.hiddenText).toEqual([]);
    expect(words(docx.text)).toEqual(words(SAMPLE_RESUME));
  });

  it("test_dense_resume_shrinks_to_fit_and_overflow_flows_to_page_two", async () => {
    const extra = Array.from({ length: 6 }, (_, i) => `• Additional bullet ${i + 1} describing a further piece of operations work in moderate detail`);
    const dense = SAMPLE_RESUME.replace("PROJECTS", `${extra.join("\n")}\nPROJECTS`);
    expect((await PDFDocument.load(await exportPdf(dense, "classic"))).getPageCount()).toBe(1);

    const long = [SAMPLE_RESUME, ...Array.from({ length: 60 }, (_, i) => `• Bullet number ${i + 1} describing a piece of work in some detail`)].join("\n");
    expect((await PDFDocument.load(await exportPdf(long, "classic"))).getPageCount()).toBeGreaterThan(1);
  });

  it("test_pdf_swaps_lookalikes_and_names_unshowable_characters", async () => {
    const bad = `${SAMPLE_RESUME}\n• Presented in Mandarin (普通话)`;
    await expect(exportPdf(bad, "classic")).rejects.toThrow(ExportError);
    await expect(exportPdf(bad, "modern")).rejects.toThrow(/普/);
    // DOCX has no font limit.
    expect(extractDocx(await exportDocx(bad, "classic")).text).toContain("普通话");
  });
});

describe("REQ-AG-44 metadata", () => {
  it.each(TEMPLATES)("test_%s_exports_carry_no_metadata_and_are_deterministic", async (template) => {
    const bytes = await exportDocx(SAMPLE_RESUME, template);
    const parts = unzipSync(bytes);
    expect(Object.keys(parts).some((n) => n.startsWith("docProps/"))).toBe(false);
    expect(new TextDecoder().decode(parts["word/document.xml"])).not.toMatch(/w:rsid|w:author|w:comment|w:ins |w:del /);
    expect(await exportDocx(SAMPLE_RESUME, template)).toEqual(bytes);

    const pdfBytes = await exportPdf(SAMPLE_RESUME, template);
    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    expect(pdf.getAuthor()).toBeUndefined();
    expect(pdf.getTitle()).toBeUndefined();
    expect(pdf.getCreator()).toBeUndefined();
    expect(pdf.getProducer()).toBeUndefined();
    expect(pdf.getCreationDate()).toBeUndefined();
    expect(await exportPdf(SAMPLE_RESUME, template)).toEqual(pdfBytes);
  });
});

describe("typesetting", () => {
  it("test_wrapped_text_never_ends_with_a_stranded_word", async () => {
    const { StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = "Built an Excel acquisition model for small business deals and ranked the targets on risk";
    // Width chosen so a greedy wrap leaves "risk" alone on the last line.
    const firstLine = "Built an Excel acquisition model for small business deals and ranked the targets on";
    const maxWidth = font.widthOfTextAtSize(firstLine, 10) + 1;
    const lines = (await import("@/lib/agent/export")).wrapText(text, font, 10, maxWidth);
    expect(lines.length).toBe(2);
    expect(lines[1].trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(text);
  });
});
