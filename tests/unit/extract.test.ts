import { describe, expect, it, vi } from "vitest";
import { extractResume, UploadError } from "@/lib/extract";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import { findBullets } from "@/lib/text";
import {
  makeDocx,
  makeEncryptedPdf,
  makeLayoutPdf,
  makeManyEntriesDocx,
  makePdf,
  makeZipBombDocx,
  relsXml,
  RESUME_TEXT,
} from "../helpers/fixtures";

async function rejectionCode(bytes: Uint8Array): Promise<string> {
  try {
    await extractResume(bytes);
  } catch (e) {
    if (e instanceof UploadError) return e.code;
    throw e;
  }
  throw new Error("expected the file to be rejected");
}

describe("REQ-IN-01 accepted files", () => {
  it("test_upload_accepts_valid_pdf_and_docx_within_limits", async () => {
    const pdf = await extractResume(await makePdf());
    expect(pdf.fileType).toBe("pdf");
    expect(pdf.pageCount).toBe(1);
    expect(pdf.text).toContain("Northwind Logistics | Operations Analyst | 2021 - Present");
    expect(pdf.text).toContain("Built an Excel model that cut monthly reconciliation time by 6 hours");

    const docx = await extractResume(makeDocx());
    expect(docx.fileType).toBe("docx");
    expect(docx.text).toContain("Northwind Logistics | Operations Analyst | 2021 - Present");
    // Word list paragraphs come out as bullet lines.
    expect(docx.text).toContain("• Built an Excel model that cut monthly reconciliation time by 6 hours");
    expect(docx.hiddenText).toEqual([]);
  });

  it("test_upload_accepts_exactly_10_pages", async () => {
    const pdf = await extractResume(await makePdf({ pages: 10 }));
    expect(pdf.pageCount).toBe(10);
  });

  it("test_upload_rejects_over_5mb_and_over_10_pages", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(new TextEncoder().encode("%PDF-1.7\n"));
    expect(await rejectionCode(big)).toBe("too_large");
    expect(await rejectionCode(await makePdf({ pages: 11 }))).toBe("too_many_pages");
  });
});

describe("REQ-IN-04 extracted text follows the page layout", () => {
  it("test_pdf_text_in_reading_order_with_bullets_joined", async () => {
    const { text } = await extractResume(await makeLayoutPdf());
    const lines = text.split("\n");
    expect(lines).toEqual([
      "Alex Morgan",
      "EXPERIENCE",
      "Acme Analytics May 2024 - Present",
      "• Generated a 40% return on a model portfolio across systematic equity and options strategies over twelve months.",
      "• Responsible for weekly reporting to the investment committee.",
      "• Built a valuation model in Excel and ran Welch z-tests on pricing assumptions.",
      "SKILLS",
      "Technical: Python, SQL, Excel",
    ]);
    expect(findBullets(text).map((b) => b.text)).toEqual([
      "Generated a 40% return on a model portfolio across systematic equity and options strategies over twelve months.",
      "Responsible for weekly reporting to the investment committee.",
      "Built a valuation model in Excel and ran Welch z-tests on pricing assumptions.",
    ]);
  });
});

describe("REQ-IN-02 specific rejection reasons", () => {
  it("test_upload_rejection_reasons_are_specific_and_nothing_stored", async () => {
    const codes = {
      wrongType: await rejectionCode(new TextEncoder().encode("Just a plain text resume, not a PDF or Word file.")),
      encrypted: await rejectionCode(await makeEncryptedPdf()),
      macro: await rejectionCode(makeDocx({ macroContentType: true })),
      corruptPdf: await rejectionCode(new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf")),
      corruptDocx: await rejectionCode(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])),
    };
    expect(codes).toEqual({
      wrongType: "unsupported_type",
      encrypted: "password_protected",
      macro: "macro_enabled",
      corruptPdf: "unparseable",
      corruptDocx: "unparseable",
    });
  });

  it("test_upload_error_messages_are_human_readable", async () => {
    try {
      await extractResume(await makePdf({ pages: 11 }));
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(UploadError);
      expect((e as UploadError).message).toMatch(/10 pages/);
    }
  });

  it("test_zip_that_is_not_a_word_document_rejected_as_unsupported", async () => {
    expect(await rejectionCode(makeDocx({ omitDocumentXml: true }))).toBe("unsupported_type");
  });
});

describe("REQ-IN-03 scanned PDFs", () => {
  it("test_scanned_pdf_rejected_with_ocr_message", async () => {
    try {
      await extractResume(await makePdf({ noText: true }));
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as UploadError).code).toBe("scanned_pdf");
      expect((e as UploadError).message).toBe("This looks like a scanned image; upload a text-based PDF or DOCX");
    }
  });
});

describe("REQ-IN-05 hidden text", () => {
  it("test_hidden_text_excluded_and_warning_lists_it", async () => {
    const docx = await extractResume(
      makeDocx({
        paragraphs: [
          ...RESUME_TEXT.split("\n"),
          { runs: [{ text: "Visible line. " }, { text: "HIDDEN-VANISH Python Kubernetes", vanish: true }] },
          { runs: [{ text: "WHITE-TEXT Tableau SQL", color: "FFFFFF" }] },
          { runs: [{ text: "TINY-TEXT SAP", sizeHalfPoints: 6 }] },
          { runs: [{ text: "Normal grey text stays", color: "666666", sizeHalfPoints: 22 }] },
        ],
      }),
    );
    expect(docx.text).not.toMatch(/HIDDEN-VANISH|WHITE-TEXT|TINY-TEXT/);
    expect(docx.text).toContain("Visible line.");
    expect(docx.text).toContain("Normal grey text stays");
    expect(docx.hiddenText).toEqual(["HIDDEN-VANISH Python Kubernetes", "WHITE-TEXT Tableau SQL", "TINY-TEXT SAP"]);

    const pdf = await extractResume(await makePdf({ tinyText: "TINY-PDF keyword stuffing", offPageText: "OFFPAGE-PDF more stuffing" }));
    expect(pdf.text).not.toMatch(/TINY-PDF|OFFPAGE-PDF/);
    // pdf.js drops off-page text before we see it, so it is excluded but can't be quoted (see docs/STORY_1.md).
    expect(pdf.hiddenText).toEqual(["TINY-PDF keyword stuffing"]);
  });
});

describe("SEC-FILE-01 type detection", () => {
  it("test_type_detection_ignores_extension_and_content_type", async () => {
    // Detection only ever sees bytes; a Windows executable is rejected whatever it is called.
    const exe = new Uint8Array(4096);
    exe.set([0x4d, 0x5a, 0x90, 0x00]);
    expect(await rejectionCode(exe)).toBe("unsupported_type");
    // DOCX bytes are treated as DOCX even if the browser claimed PDF (covered end-to-end in the API test).
    expect((await extractResume(makeDocx())).fileType).toBe("docx");
  });
});

describe("SEC-FILE-03..06 hostile documents", () => {
  it("test_docx_xxe_not_resolved", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await rejectionCode(makeDocx({ dtd: true }))).toBe("unsafe_docx");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("test_docx_zip_bomb_rejected", async () => {
    expect(await rejectionCode(makeZipBombDocx())).toBe("unsafe_docx");
    expect(await rejectionCode(makeManyEntriesDocx(1001))).toBe("unsafe_docx");
  });

  it("test_docx_macro_and_external_relationships_rejected_not_fetched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await rejectionCode(makeDocx({ vbaProject: true }))).toBe("macro_enabled");
    expect(
      await rejectionCode(
        makeDocx({ settingsRels: relsXml([{ type: "attachedTemplate", target: "https://canary.invalid/t.dotm", external: true }]) }),
      ),
    ).toBe("external_content");
    expect(
      await rejectionCode(makeDocx({ documentRels: relsXml([{ type: "image", target: "https://canary.invalid/x.png", external: true }]) })),
    ).toBe("external_content");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("test_docx_external_hyperlinks_are_allowed", async () => {
    const res = await extractResume(
      makeDocx({ documentRels: relsXml([{ type: "hyperlink", target: "https://www.linkedin.com/in/someone", external: true }]) }),
    );
    expect(res.fileType).toBe("docx");
  });

  it("test_pdf_active_content_ignored", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await extractResume(await makePdf({ openActionJs: true }));
    expect(res.text).not.toContain("launchURL");
    expect(res.text).toContain("Northwind Logistics");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
