import { strToU8, zipSync, type Zippable } from "fflate";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";

export const RESUME_LINES = [
  "Jordan Lee",
  "Operations Analyst",
  "Work Experience",
  "Northwind Logistics | Operations Analyst | 2021 - Present",
  "• Responsible for weekly inventory reports for the regional warehouse team",
  "• Helped the team with vendor onboarding and scheduling",
  "• Built an Excel model that cut monthly reconciliation time by 6 hours",
  "• Worked on process documentation for shipping and receiving",
  "• Presented supply chain findings to senior managers each quarter",
  "Education",
  "BSc Business Administration, State University, 2020",
];

export const RESUME_TEXT = RESUME_LINES.join("\n");

export const JOB_DESCRIPTION = `Senior Operations Analyst - Supply Chain

We are looking for a Senior Operations Analyst to join our supply chain team. You will own demand forecasting, build dashboards in Tableau and Power BI, and write SQL queries against our data warehouse to find savings.

Responsibilities:
- Lead demand forecasting and inventory optimization across 12 distribution centers.
- Build and maintain Tableau dashboards and SQL data pipelines for leadership.
- Partner with procurement on vendor management and contract negotiation.
- Drive continuous improvement projects using Lean Six Sigma methods.
- Communicate insights to stakeholders with clear data storytelling.

Requirements:
- 4+ years in supply chain analytics or operations.
- Advanced SQL and Excel; Python is a plus.
- Experience with ERP systems such as SAP.
- Strong stakeholder management and cross-functional collaboration skills.`;

// ---------- PDF builders ----------

type PdfOptions = {
  pages?: number;
  lines?: string[];
  tinyText?: string;
  offPageText?: string;
  noText?: boolean;
  openActionJs?: boolean;
};

export async function makePdf(opts: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageCount = opts.pages ?? 1;
  const lines = opts.lines ?? RESUME_LINES;
  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([612, 792]);
    if (opts.noText) {
      page.drawRectangle({ x: 50, y: 50, width: 500, height: 600 });
      continue;
    }
    if (p === 0) {
      lines.forEach((line, i) => {
        // Helvetica in pdf-lib is WinAnsi, which has no "•"; use "-" as the bullet glyph.
        page.drawText(line.replace(/^•/, "-"), { x: 50, y: 740 - i * 18, size: 11, font });
      });
      if (opts.tinyText) page.drawText(opts.tinyText, { x: 50, y: 300, size: 2, font });
      if (opts.offPageText) page.drawText(opts.offPageText, { x: -2000, y: 400, size: 11, font });
    } else {
      page.drawText(`Page ${p + 1} additional experience details for testing.`, { x: 50, y: 740, size: 11, font });
    }
  }
  if (opts.openActionJs) {
    const js = doc.context.obj({
      Type: "Action",
      S: "JavaScript",
      JS: PDFString.of("app.launchURL('https://canary.invalid/pdf-js', true);"),
    });
    doc.catalog.set(PDFName.of("OpenAction"), js);
  }
  return doc.save({ useObjectStreams: false });
}

/**
 * A resume laid out like common Word/Docs exports: headings at the margin, small "•" glyphs drawn
 * separately just left of indented bullet text, wrapped bullet lines, right-aligned dates, and a
 * content stream that draws headings first, then bullet text, then the bullet glyphs.
 */
export async function makeLayoutPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const headings: [string, number][] = [
    ["Alex Morgan", 740],
    ["EXPERIENCE", 715],
    ["Acme Analytics", 700],
    ["SKILLS", 600],
    ["Technical: Python, SQL, Excel", 585],
  ];
  const bullets: { lines: string[]; y: number }[] = [
    { lines: ["Generated a 40% return on a model portfolio across systematic equity and options", "strategies over twelve months."], y: 685 },
    { lines: ["Responsible for weekly reporting to the investment committee."], y: 658 },
    { lines: ["Built a valuation model in Excel and ran Welch z-", "tests on pricing assumptions."], y: 645 },
  ];
  for (const [text, y] of headings) page.drawText(text, { x: 45, y, size: 10, font });
  page.drawText("May 2024 - Present", { x: 480, y: 700, size: 10, font });
  for (const b of bullets) b.lines.forEach((line, i) => page.drawText(line, { x: 60, y: b.y - i * 12, size: 10, font }));
  for (const b of bullets) page.drawText("•", { x: 49, y: b.y + 2, size: 6.6, font });
  return doc.save({ useObjectStreams: false });
}

/** A PDF whose trailer declares an /Encrypt dictionary, as password-protected PDFs do. */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const bytes = await makePdf();
  const text = Buffer.from(bytes).toString("latin1");
  const patched = text.replace(/trailer\s*<</, (m) => `${m}\n/Encrypt << /Filter /Standard /V 2 /R 3 /Length 128 /P -4 >>`);
  if (patched === text) throw new Error("fixture: no trailer found");
  return new Uint8Array(Buffer.from(patched, "latin1"));
}

// ---------- DOCX builders ----------

export type DocxRun = {
  text: string;
  vanish?: boolean;
  color?: string;
  sizeHalfPoints?: number;
};
export type DocxParagraph = { runs: DocxRun[]; bullet?: boolean } | string;

type DocxOptions = {
  paragraphs?: DocxParagraph[];
  macroContentType?: boolean;
  vbaProject?: boolean;
  dtd?: boolean;
  documentRels?: string;
  settingsRels?: string;
  extraFiles?: Zippable;
  omitDocumentXml?: boolean;
};

const MAIN_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const MACRO_CT = "application/vnd.ms-word.document.macroEnabled.main+xml";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphXml(p: DocxParagraph): string {
  const para = typeof p === "string" ? { runs: [{ text: p.replace(/^•\s*/, "") }], bullet: p.startsWith("•") } : p;
  const pPr = para.bullet ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : "";
  const runs = para.runs
    .map((r) => {
      const props = [
        r.vanish ? "<w:vanish/>" : "",
        r.color ? `<w:color w:val="${r.color}"/>` : "",
        r.sizeHalfPoints ? `<w:sz w:val="${r.sizeHalfPoints}"/>` : "",
      ].join("");
      const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
    })
    .join("");
  return `<w:p>${pPr}${runs}</w:p>`;
}

export function makeDocx(opts: DocxOptions = {}): Uint8Array {
  const paragraphs = opts.paragraphs ?? RESUME_LINES;
  const dtd = opts.dtd ? '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' : "";
  const body = paragraphs.map(paragraphXml).join("") + (opts.dtd ? "<w:p><w:r><w:t>&xxe;</w:t></w:r></w:p>" : "");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${dtd}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${opts.macroContentType ? MACRO_CT : MAIN_CT}"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const files: Zippable = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
  };
  if (!opts.omitDocumentXml) files["word/document.xml"] = strToU8(documentXml);
  if (opts.documentRels) files["word/_rels/document.xml.rels"] = strToU8(opts.documentRels);
  if (opts.settingsRels) files["word/_rels/settings.xml.rels"] = strToU8(opts.settingsRels);
  if (opts.vbaProject) files["word/vbaProject.bin"] = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]);
  Object.assign(files, opts.extraFiles ?? {});
  return zipSync(files);
}

export function relsXml(rels: { type: string; target: string; external?: boolean }[]): string {
  const items = rels
    .map(
      (r, i) =>
        `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ""}/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
}

/** A DOCX containing one entry that inflates at well over 100:1. */
export function makeZipBombDocx(): Uint8Array {
  return makeDocx({ extraFiles: { "word/media/padding.bin": [new Uint8Array(20 * 1024 * 1024), { level: 9 }] } });
}

export function makeManyEntriesDocx(count = 1001): Uint8Array {
  const extra: Zippable = {};
  for (let i = 0; i < count; i++) extra[`word/parts/p${i}.xml`] = strToU8(`<x>${i}</x>`);
  return makeDocx({ extraFiles: extra });
}

/** Builds the multipart request a browser sends when uploading `bytes` under `filename`. */
export function uploadRequest(bytes: Uint8Array, filename: string, opts: { type?: string; origin?: string } = {}): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: opts.type ?? "application/octet-stream" }));
  const headers: Record<string, string> = { host: "localhost:3000" };
  if (opts.origin) headers.origin = opts.origin;
  return new Request("http://localhost:3000/api/extract", { method: "POST", body: form, headers });
}
