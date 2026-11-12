// Export of the tailored resume as DOCX and PDF (REQ-AG-41, REQ-AG-42, REQ-AG-44).
// One plain layout (A-58). Files are built per request and never stored.

import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type LayoutKind = "name" | "heading" | "bullet" | "line" | "blank";
export type LayoutLine = { kind: LayoutKind; text: string };

export class ExportError extends Error {
  constructor(
    readonly code: "unsupported_characters",
    message: string,
    readonly characters: string[] = [],
  ) {
    super(message);
    this.name = "ExportError";
  }
}

const BULLET = /^\s*[•▪◦‣∙·●○■□➢➤►✓✔\-*–—]\s+/;
const SECTION_NAME =
  /^(?:summary|profile|objective|(?:work |professional |relevant )?experience|employment(?: history)?|education|(?:technical )?skills?(?: (?:&|and) interests)?|interests|projects?|(?:leadership|volunteer)(?: experience)?|activities|certifications?(?: (?:&|and) licenses)?|licenses|awards|honors|publications|additional information|languages|(?:relevant )?coursework)$/i;

function isHeading(line: string): boolean {
  const t = line.trim().replace(/:$/, "");
  if (t.length === 0 || t.length > 40) return false;
  if (SECTION_NAME.test(t)) return true;
  return /^[A-Z][A-Z &/-]{2,}$/.test(t) && t.split(/\s+/).length <= 4;
}

/** Classifies each line of the resume for the export layout. Text is kept as written. */
export function layoutLines(text: string): LayoutLine[] {
  let nameSeen = false;
  return text.split(/\r?\n/).map((raw): LayoutLine => {
    const line = raw.replace(/\t/g, " ").trimEnd();
    if (!line.trim()) return { kind: "blank", text: "" };
    if (!nameSeen) {
      nameSeen = true;
      return { kind: "name", text: line.trim() };
    }
    if (BULLET.test(line)) return { kind: "bullet", text: line.replace(BULLET, "").trim() };
    if (isHeading(line)) return { kind: "heading", text: line.trim() };
    return { kind: "line", text: line.trim() };
  });
}

// ---------- DOCX ----------

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// XML 1.0 can't hold most control characters.
function xmlSafe(s: string): string {
  return xmlEscape(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""));
}

function docxParagraph(text: string, opts: { bold?: boolean; size: number; before?: number; after?: number; indent?: boolean; rule?: boolean }): string {
  const pPr = [
    opts.rule ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="808080"/></w:pBdr>' : "",
    `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 40}"/>`,
    opts.indent ? '<w:ind w:left="300" w:hanging="200"/>' : "",
  ].join("");
  const rPr = `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>${opts.bold ? "<w:b/>" : ""}<w:sz w:val="${opts.size}"/>`;
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlSafe(text)}</w:t></w:r></w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/**
 * Builds a minimal DOCX: content types, one relationship and the document. There is no docProps part,
 * so author, company, dates and the rest are blank by construction (SEC-EXP-01). Same input, same bytes.
 */
export function exportDocx(text: string): Uint8Array {
  const body = layoutLines(text)
    .filter((l) => l.kind !== "blank")
    .map((l) => {
      switch (l.kind) {
        case "name":
          return docxParagraph(l.text, { bold: true, size: 32, after: 60 });
        case "heading":
          return docxParagraph(l.text, { bold: true, size: 22, before: 200, after: 80, rule: true });
        case "bullet":
          return docxParagraph(`• ${l.text}`, { size: 21, indent: true });
        default:
          return docxParagraph(l.text, { size: 21 });
      }
    })
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const mtime = new Date(1980, 0, 1);
  return zipSync(
    {
      "[Content_Types].xml": [strToU8(CONTENT_TYPES), { mtime }],
      "_rels/.rels": [strToU8(ROOT_RELS), { mtime }],
      "word/document.xml": [strToU8(document), { mtime }],
    },
    { level: 6 },
  );
}

// ---------- PDF ----------

/** Characters Helvetica can't show, swapped for look-alikes it can (REQ-AG-42). */
const LOOKALIKES: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "−": "-",
  "✓": "-", "✔": "-", "✗": "x", "✘": "x", "′": "'", "″": '"',
  " ": " ", " ": " ", " ": " ", " ": " ",
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const BODY = 10.5;

function swapLookalikes(s: string): string {
  return [...s].map((c) => LOOKALIKES[c] ?? c).join("");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/ +/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    // A single word wider than the line is broken by characters.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Builds a PDF in the plain layout. Fails with ExportError, naming the characters, if the text has any
 * the font can't show after look-alike swaps. No metadata is written (SEC-EXP-01). Same input, same bytes.
 */
export async function exportPdf(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const lines = layoutLines(text).map((l) => ({ ...l, text: swapLookalikes(l.text) }));
  const unshowable = new Set<string>();
  for (const l of lines) {
    for (const c of l.text) {
      try {
        regular.encodeText(c);
        bold.encodeText(c);
      } catch {
        unshowable.add(c);
      }
    }
  }
  if (unshowable.size > 0) {
    const chars = [...unshowable];
    throw new ExportError(
      "unsupported_characters",
      `The PDF font can't show ${chars.map((c) => `"${c}"`).join(", ")}. Download the DOCX instead, or remove those characters.`,
      chars,
    );
  }

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const width = PAGE_W - 2 * MARGIN;
  const room = (h: number) => {
    if (y - h < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };
  const drawWrapped = (s: string, font: PDFFont, size: number, x: number, maxWidth: number, lead: number) => {
    for (const part of wrap(s, font, size, maxWidth)) {
      room(lead);
      y -= lead;
      page.drawText(part, { x, y, size, font });
    }
  };

  let first = true;
  for (const l of lines) {
    switch (l.kind) {
      case "blank":
        y -= 4;
        break;
      case "name":
        drawWrapped(l.text, bold, 16, MARGIN, width, 18);
        y -= 4;
        break;
      case "heading":
        if (!first) y -= 8;
        room(30);
        drawWrapped(l.text, bold, 11, MARGIN, width, 14);
        page.drawLine({ start: { x: MARGIN, y: y - 3 }, end: { x: PAGE_W - MARGIN, y: y - 3 }, thickness: 0.6, color: rgb(0.5, 0.5, 0.5) });
        y -= 6;
        break;
      case "bullet": {
        const parts = wrap(l.text, regular, BODY, width - 14);
        parts.forEach((part, i) => {
          room(13);
          y -= 13;
          if (i === 0) page.drawText("•", { x: MARGIN + 3, y, size: BODY, font: regular });
          page.drawText(part, { x: MARGIN + 14, y, size: BODY, font: regular });
        });
        break;
      }
      default:
        drawWrapped(l.text, regular, BODY, MARGIN, width, 13);
    }
    first = false;
  }
  return doc.save();
}
