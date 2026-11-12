import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ExportError, exportDocx, exportPdf, layoutLines } from "@/lib/agent/export";
import { extractDocx } from "@/lib/extract/docx";
import { extractPdf } from "@/lib/extract/pdf";
import { RESUME_TEXT } from "../helpers/fixtures";

const RESUME = [
  "Jordan Lee",
  "Pittsburgh, PA · jordan.lee@example.com · (412) 555-0100",
  "",
  "WORK EXPERIENCE",
  "Northwind Logistics | Operations Analyst | 2021 – Present",
  "• Built an Excel model that cut monthly reconciliation time by 6 hours, which let the regional warehouse team close the books two days earlier every month and freed time for “exception” reviews",
  "- Presented supply chain findings to senior managers each quarter",
  "Education",
  "BSc Business Administration, State University, 2020",
].join("\n");

/** Words in order, ignoring bullet glyphs, line breaks and spacing. */
function words(text: string): string[] {
  return text.replace(/[•\-–]\s/g, " ").split(/\s+/).filter(Boolean);
}

describe("REQ-AG-41 layout and round trip", () => {
  it("test_layout_finds_name_headings_and_bullets", () => {
    const lines = layoutLines(RESUME_TEXT);
    expect(lines[0]).toEqual({ kind: "name", text: "Jordan Lee" });
    expect(lines.filter((l) => l.kind === "heading").map((l) => l.text)).toEqual(["Work Experience", "Education"]);
    expect(lines.filter((l) => l.kind === "bullet")).toHaveLength(5);
    expect(lines.find((l) => l.kind === "bullet")?.text).toBe("Responsible for weekly inventory reports for the regional warehouse team");
  });

  it("test_docx_and_pdf_exports_round_trip_through_extractors", async () => {
    const docx = extractDocx(exportDocx(RESUME));
    expect(docx.hiddenText).toEqual([]);
    expect(docx.text.split("\n").filter((l) => l.trim())).toEqual(
      RESUME.split("\n")
        .filter((l) => l.trim())
        .map((l) => l.replace(/^- /, "• ")),
    );

    const pdf = await extractPdf(await exportPdf(RESUME));
    expect(pdf.hiddenText).toEqual([]);
    expect(words(pdf.text)).toEqual(words(RESUME));
  });

  it("test_long_resume_flows_onto_more_pages", async () => {
    const long = [RESUME, ...Array.from({ length: 80 }, (_, i) => `• Bullet number ${i + 1} describing a piece of work in some detail`)].join("\n");
    const pdf = await PDFDocument.load(await exportPdf(long));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
  });
});

describe("REQ-AG-42 PDF characters", () => {
  it("test_pdf_swaps_lookalikes_and_names_unshowable_characters", async () => {
    const swapped = await extractPdf(await exportPdf(`${RESUME}\n• Cut costs ≥ 10% → saved $5k ✓`));
    expect(swapped.text).toContain("Cut costs >= 10% -> saved $5k");

    const bad = `${RESUME}\n• Presented in Mandarin (普通话)`;
    await expect(exportPdf(bad)).rejects.toThrow(ExportError);
    await expect(exportPdf(bad)).rejects.toThrow(/普/);
    // DOCX has no font limit.
    expect(extractDocx(exportDocx(bad)).text).toContain("普通话");
  });
});

describe("REQ-AG-44 metadata", () => {
  it("test_exports_carry_no_metadata_and_are_deterministic", async () => {
    const bytes = exportDocx(RESUME);
    const names = Object.keys(unzipSync(bytes));
    expect(names.some((n) => n.startsWith("docProps/"))).toBe(false);
    const xml = new TextDecoder().decode(unzipSync(bytes)["word/document.xml"]);
    expect(xml).not.toMatch(/w:rsid|w:author|w:comment|w:ins |w:del /);
    expect(exportDocx(RESUME)).toEqual(bytes);

    const pdfBytes = await exportPdf(RESUME);
    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    expect(pdf.getAuthor()).toBeUndefined();
    expect(pdf.getTitle()).toBeUndefined();
    expect(pdf.getCreator()).toBeUndefined();
    expect(pdf.getProducer()).toBeUndefined();
    expect(pdf.getCreationDate()).toBeUndefined();
    expect(await exportPdf(RESUME)).toEqual(pdfBytes);
  });
});
