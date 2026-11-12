// Export of the tailored resume in one of three templates, as PDF or DOCX (REQ-AG-41, REQ-AG-42, REQ-AG-44).
// The PDF embeds open fonts; the DOCX names the Word font each one matches, and uses the same scale the PDF
// needed to fit, so both formats look and fit alike. Files are built per request and never stored.

import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, rgb, type PDFFont, type RGB } from "pdf-lib";
import { parseResume, type Block } from "./structure";

export const TEMPLATES = ["classic", "modern", "compact"] as const;
export type TemplateId = (typeof TEMPLATES)[number];
export const TEMPLATE_LABELS: Record<TemplateId, string> = { classic: "Classic", modern: "Modern", compact: "Compact" };

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

// ---------- templates ----------

type FontFiles = { regular: string; bold: string; italic: string; docx: string };
type Hex = string;

type Style = {
  fonts: FontFiles;
  margin: { x: number; y: number };
  leading: number;
  body: number;
  name: { size: number; align: "center" | "left"; color: Hex };
  contact: { size: number; align: "center" | "left"; color: Hex };
  /** A rule under the name and contact lines. */
  headerRule: { color: Hex; width: number } | null;
  heading: { size: number; upper: boolean; color: Hex; rule: Hex | null; ruleWidth: number; before: number; after: number };
  entryBefore: number;
  secondaryItalic: boolean;
  right: { italic: boolean; color: Hex };
  /** `before`: extra space between a role line and its first bullet. */
  bullet: { glyphX: number; indent: number; before: number };
};

const BLACK = "#000000";

export const STYLES: Record<TemplateId, Style> = {
  // Traditional one-page business resume: serif, centred name, ruled capital headings, dates on the right.
  classic: {
    fonts: { regular: "LiberationSerif-Regular", bold: "LiberationSerif-Bold", italic: "LiberationSerif-Italic", docx: "Times New Roman" },
    margin: { x: 43, y: 36 },
    leading: 1.17,
    body: 10.5,
    name: { size: 20, align: "center", color: BLACK },
    contact: { size: 9.5, align: "center", color: BLACK },
    headerRule: null,
    heading: { size: 11.5, upper: true, color: BLACK, rule: BLACK, ruleWidth: 0.8, before: 8, after: 4 },
    entryBefore: 4,
    secondaryItalic: false,
    right: { italic: false, color: BLACK },
    bullet: { glyphX: 5, indent: 15, before: 0 },
  },
  // Sans serif with a navy accent: left-aligned name over a navy rule, title-case headings, roles in italics,
  // bullets nested under their role.
  modern: {
    fonts: { regular: "Lato-Regular", bold: "Lato-Bold", italic: "Lato-Italic", docx: "Calibri" },
    margin: { x: 48, y: 38 },
    leading: 1.2,
    body: 10.5,
    name: { size: 22, align: "left", color: "#1F3A5F" },
    contact: { size: 9.5, align: "left", color: "#4A5260" },
    headerRule: { color: "#1F3A5F", width: 1.4 },
    heading: { size: 11.5, upper: false, color: "#1F3A5F", rule: "#B4BFCE", ruleWidth: 0.6, before: 9, after: 3.5 },
    entryBefore: 5,
    secondaryItalic: true,
    right: { italic: false, color: "#4A5260" },
    bullet: { glyphX: 9, indent: 19, before: 1.5 },
  },
  // Dense layout for a full page: small sans serif, tight spacing, grey rules.
  compact: {
    fonts: { regular: "LiberationSans-Regular", bold: "LiberationSans-Bold", italic: "LiberationSans-Italic", docx: "Arial" },
    margin: { x: 36, y: 30 },
    leading: 1.13,
    body: 9.5,
    name: { size: 16, align: "left", color: BLACK },
    contact: { size: 9, align: "left", color: "#333333" },
    headerRule: null,
    heading: { size: 10, upper: true, color: BLACK, rule: "#8C8C8C", ruleWidth: 0.6, before: 6, after: 2.5 },
    entryBefore: 3,
    secondaryItalic: true,
    right: { italic: false, color: "#333333" },
    bullet: { glyphX: 3, indent: 11, before: 0 },
  },
};

const PAGE_W = 612;
const PAGE_H = 792;
/** Smallest body size the fit may shrink to. Below this a resume flows onto a second page instead. */
const MIN_BODY = 9;

// ---------- fonts ----------

const fontCache = new Map<string, Uint8Array>();
function fontBytes(name: string): Uint8Array {
  let bytes = fontCache.get(name);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "assets", "fonts", `${name}.ttf`)));
    fontCache.set(name, bytes);
  }
  return bytes;
}

type GlyphFont = { hasGlyphForCodePoint(cp: number): boolean };
const glyphCache = new Map<string, GlyphFont>();
function glyphFont(name: string): GlyphFont {
  let f = glyphCache.get(name);
  if (!f) {
    f = fontkit.create(Buffer.from(fontBytes(name))) as unknown as GlyphFont;
    glyphCache.set(name, f);
  }
  return f;
}

/** Characters a font may lack, swapped for look-alikes (REQ-AG-42). Applied only when the glyph is missing. */
const LOOKALIKES: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "≥": ">=", "≤": "<=", "≠": "!=", "≈": "~", "−": "-",
  "✓": "-", "✔": "-", "✗": "x", "✘": "x", "′": "'", "″": '"', " ": " ", " ": " ", " ": " ", " ": " ",
};

/** Applies look-alikes for glyphs the template's fonts lack, and throws naming any character still missing. */
function prepareText(blocks: Block[], style: Style): Block[] {
  const fonts = [style.fonts.regular, style.fonts.bold, style.fonts.italic].map(glyphFont);
  const missing = new Set<string>();
  const fix = (s: string) =>
    [...s.replace(/[\u0000-\u0008\u000B-\u001F]/g, "").replace(/\t/g, " ")]
      .map((c) => {
        const cp = c.codePointAt(0)!;
        if (fonts.every((f) => f.hasGlyphForCodePoint(cp))) return c;
        const swap = LOOKALIKES[c];
        if (swap !== undefined) return swap;
        missing.add(c);
        return c;
      })
      .join("");
  const out = blocks.map((b): Block => {
    switch (b.kind) {
      case "entry":
        return { ...b, left: fix(b.left), right: fix(b.right) };
      case "labeled":
        return { ...b, label: fix(b.label), text: fix(b.text) };
      default:
        return { ...b, text: fix(b.text) };
    }
  });
  if (missing.size > 0) {
    const chars = [...missing];
    throw new ExportError(
      "unsupported_characters",
      `The PDF font can't show ${chars.map((c) => `"${c}"`).join(", ")}. Download the DOCX instead, or remove those characters.`,
      chars,
    );
  }
  return out;
}

function titleCase(s: string): string {
  const small = new Set(["a", "an", "and", "the", "of", "for", "in", "on", "to", "&"]);
  return s
    .toLowerCase()
    .split(/(\s+|\/)/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

function headingText(text: string, style: Style): string {
  return style.heading.upper ? text.toUpperCase() : text === text.toUpperCase() ? titleCase(text) : text;
}

function hexToRgb(hex: Hex): RGB {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ---------- layout ----------

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };
type Seg = { text: string; font: PDFFont };
type TextOp = { page: number; x: number; y: number; text: string; font: PDFFont; size: number; color: Hex };
type RuleOp = { page: number; x1: number; x2: number; y: number; width: number; color: Hex };
type Layout = { pages: number; texts: TextOp[]; rules: RuleOp[] };

function segWidth(seg: Seg, size: number): number {
  return seg.font.widthOfTextAtSize(seg.text, size);
}

/** Greedy word wrap over runs in different fonts. Returns lines of runs. */
function wrapSegs(segs: Seg[], size: number, maxWidth: number): Seg[][] {
  type Word = { text: string; font: PDFFont; space: boolean };
  const words: Word[] = [];
  for (const s of segs) {
    s.text.split(/ +/).forEach((w, i) => {
      if (w) words.push({ text: w, font: s.font, space: i > 0 || s.text.startsWith(" ") });
    });
  }
  const lines: Seg[][] = [];
  let line: Seg[] = [];
  let width = 0;
  const push = (w: Word, withSpace: boolean) => {
    const text = (withSpace ? " " : "") + w.text;
    const last = line[line.length - 1];
    if (last && last.font === w.font) last.text += text;
    else line.push({ text, font: w.font });
    width += w.font.widthOfTextAtSize(text, size);
  };
  for (const w of words) {
    const add = (line.length && w.space ? w.font.widthOfTextAtSize(" ", size) : 0) + w.font.widthOfTextAtSize(w.text, size);
    if (line.length && width + add > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    let word = w;
    // A single word wider than the line is broken by characters.
    while (!line.length && word.font.widthOfTextAtSize(word.text, size) > maxWidth && word.text.length > 1) {
      let cut = word.text.length - 1;
      while (cut > 1 && word.font.widthOfTextAtSize(word.text.slice(0, cut), size) > maxWidth) cut--;
      lines.push([{ text: word.text.slice(0, cut), font: word.font }]);
      word = { ...word, text: word.text.slice(cut) };
    }
    push(word, line.length > 0 && word.space);
  }
  if (line.length) lines.push(line);
  return lines;
}

function layout(blocks: Block[], style: Style, fonts: Fonts, scale: number): Layout {
  const sc = (n: number) => n * scale;
  const mx = style.margin.x;
  const my = sc(style.margin.y);
  const width = PAGE_W - 2 * mx;
  const texts: TextOp[] = [];
  const rules: RuleOp[] = [];
  let page = 0;
  let y = PAGE_H - my;

  const advance = (h: number) => {
    if (y - h < my) {
      page++;
      y = PAGE_H - my;
    }
    y -= h;
  };
  const drawLine = (segs: Seg[], x: number, size: number, color: Hex) => {
    let cx = x;
    for (const s of segs) {
      texts.push({ page, x: cx, y, text: s.text, font: s.font, size, color });
      cx += segWidth(s, size);
    }
  };
  const lineWidth = (segs: Seg[], size: number) => segs.reduce((w, s) => w + segWidth(s, size), 0);
  const paragraph = (segs: Seg[], size: number, color: Hex, x: number, maxWidth: number, align: "left" | "center" = "left") => {
    for (const l of wrapSegs(segs, size, maxWidth)) {
      advance(size * style.leading);
      const lx = align === "center" ? x + (maxWidth - lineWidth(l, size)) / 2 : x;
      drawLine(l, lx, size, color);
    }
  };

  const body = sc(style.body);
  let prev: Block | null = null;
  let headerRuleDone = !style.headerRule;
  for (const b of blocks) {
    if (!headerRuleDone && b.kind !== "name" && b.kind !== "contact") {
      headerRuleDone = true;
      y -= sc(4);
      rules.push({ page, x1: mx, x2: PAGE_W - mx, y, width: style.headerRule!.width, color: style.headerRule!.color });
      y -= sc(2);
    }
    switch (b.kind) {
      case "name":
        paragraph([{ text: b.text, font: fonts.bold }], sc(style.name.size), style.name.color, mx, width, style.name.align);
        y -= sc(2);
        break;
      case "contact":
        paragraph([{ text: b.text, font: fonts.regular }], sc(style.contact.size), style.contact.color, mx, width, style.contact.align);
        break;
      case "heading": {
        const h = style.heading;
        y -= sc(h.before);
        if (y - sc(h.size) * 3 < my) {
          // Keep a heading with what follows it.
          page++;
          y = PAGE_H - my;
        }
        paragraph([{ text: headingText(b.text, style), font: fonts.bold }], sc(h.size), h.color, mx, width);
        if (h.rule) {
          rules.push({ page, x1: mx, x2: PAGE_W - mx, y: y - sc(2.5), width: h.ruleWidth, color: h.rule });
          y -= sc(2.5);
        }
        y -= sc(h.after);
        break;
      }
      case "entry": {
        if (b.level === "primary" && prev && prev.kind !== "heading") y -= sc(style.entryBefore);
        const leftFont = b.level === "primary" ? fonts.bold : style.secondaryItalic ? fonts.italic : fonts.regular;
        const rightFont = style.right.italic ? fonts.italic : fonts.regular;
        const rightW = b.right ? rightFont.widthOfTextAtSize(b.right, body) : 0;
        const lines = wrapSegs([{ text: b.left, font: leftFont }], body, width - (rightW ? rightW + 12 : 0));
        lines.forEach((l, i) => {
          advance(body * style.leading);
          drawLine(l, mx, body, BLACK);
          if (i === 0 && b.right) texts.push({ page, x: PAGE_W - mx - rightW, y, text: b.right, font: rightFont, size: body, color: style.right.color });
        });
        break;
      }
      case "bullet": {
        if (prev?.kind === "entry") y -= sc(style.bullet.before);
        const lines = wrapSegs([{ text: b.text, font: fonts.regular }], body, width - sc(style.bullet.indent));
        lines.forEach((l, i) => {
          advance(body * style.leading);
          if (i === 0) texts.push({ page, x: mx + sc(style.bullet.glyphX), y, text: "•", font: fonts.regular, size: body, color: BLACK });
          drawLine(l, mx + sc(style.bullet.indent), body, BLACK);
        });
        break;
      }
      case "labeled":
        paragraph([{ text: `${b.label}:`, font: fonts.bold }, { text: ` ${b.text}`, font: fonts.regular }], body, BLACK, mx, width);
        break;
      default:
        paragraph([{ text: b.text, font: fonts.regular }], body, BLACK, mx, width);
    }
    prev = b;
  }
  return { pages: page + 1, texts, rules };
}

/** The largest scale (≤ 1) at which the resume fits one page without the body text going below 9 pt; 1 if it can't. */
function fitScale(blocks: Block[], style: Style, fonts: Fonts): number {
  const min = MIN_BODY / style.body;
  for (let s = 1; s >= min - 1e-9; s -= 0.02) {
    if (layout(blocks, style, fonts, s).pages === 1) return Math.round(s * 1000) / 1000;
  }
  return 1;
}

async function loadFonts(doc: PDFDocument, style: Style): Promise<Fonts> {
  doc.registerFontkit(fontkit);
    // Ligatures off: every glyph in the text layer stays one letter, so the PDF reads back exactly (ATS).
  const embed = (name: string) =>
    doc.embedFont(fontBytes(name), { subset: true, customName: name, features: { liga: false, clig: false, dlig: false } });
  const [regular, bold, italic] = await Promise.all([embed(style.fonts.regular), embed(style.fonts.bold), embed(style.fonts.italic)]);
  return { regular, bold, italic };
}

/** Lays the resume out in a template and works out the scale that fits it on one page. */
async function planFor(text: string, template: TemplateId) {
  const style = STYLES[template];
  const blocks = prepareText(parseResume(text), style);
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts = await loadFonts(doc, style);
  const scale = fitScale(blocks, style, fonts);
  return { style, blocks, doc, fonts, scale };
}

/**
 * Builds the PDF. Fails with ExportError, naming the characters, if the fonts can't show some of the
 * text after look-alike swaps. No metadata is written (SEC-EXP-01).
 */
export async function exportPdf(text: string, template: TemplateId = "classic"): Promise<Uint8Array> {
  const { style, blocks, doc, fonts, scale } = await planFor(text, template);
  const out = layout(blocks, style, fonts, scale);
  const pages = Array.from({ length: out.pages }, () => doc.addPage([PAGE_W, PAGE_H]));
  for (const r of out.rules) {
    pages[r.page].drawLine({ start: { x: r.x1, y: r.y }, end: { x: r.x2, y: r.y }, thickness: r.width, color: hexToRgb(r.color) });
  }
  for (const t of out.texts) pages[t.page].drawText(t.text, { x: t.x, y: t.y, size: t.size, font: t.font, color: hexToRgb(t.color) });
  return doc.save();
}

// ---------- DOCX ----------

function xmlSafe(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type RunOpts = { bold?: boolean; italic?: boolean; size: number; color?: Hex };

function run(text: string, font: string, o: RunOpts): string {
  const rPr =
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>` +
    (o.bold ? "<w:b/>" : "") +
    (o.italic ? "<w:i/>" : "") +
    (o.color && o.color !== BLACK ? `<w:color w:val="${o.color.slice(1)}"/>` : "") +
    `<w:sz w:val="${Math.round(o.size * 2)}"/><w:szCs w:val="${Math.round(o.size * 2)}"/>`;
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xmlSafe(text)}</w:t></w:r>`;
}

const TAB_RUN = "<w:r><w:tab/></w:r>";
const twips = (pt: number) => Math.round(pt * 20);

function paragraph(runs: string, o: { before?: number; after?: number; align?: "center" | "left"; rightTab?: number; indent?: { left: number; hanging: number }; rule?: { color: Hex; width: number }; keepNext?: boolean; line: number }): string {
  const pPr = [
    o.keepNext ? "<w:keepNext/>" : "",
    o.rule ? `<w:pBdr><w:bottom w:val="single" w:sz="${Math.max(2, Math.round(o.rule.width * 8))}" w:space="1" w:color="${o.rule.color.slice(1)}"/></w:pBdr>` : "",
    o.rightTab !== undefined ? `<w:tabs><w:tab w:val="right" w:pos="${o.rightTab}"/></w:tabs>` : "",
    `<w:spacing w:before="${twips(o.before ?? 0)}" w:after="${twips(o.after ?? 0)}" w:line="${o.line}" w:lineRule="auto"/>`,
    o.indent ? `<w:ind w:left="${twips(o.indent.left)}" w:hanging="${twips(o.indent.hanging)}"/>` : "",
    o.align === "center" ? '<w:jc w:val="center"/>' : "",
  ].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/**
 * Builds a minimal DOCX in the template, at the scale the PDF needed to fit one page. There is no docProps
 * part, so author, company, dates and the rest are blank by construction (SEC-EXP-01). Same input, same bytes.
 */
export async function exportDocx(text: string, template: TemplateId = "classic"): Promise<Uint8Array> {
  const { style, blocks, scale } = await planFor(text, template).catch((e) => {
    // DOCX has no font limit: plan with the raw text if the PDF fonts lack a character.
    if (e instanceof ExportError) return { style: STYLES[template], blocks: parseResume(text), scale: 1 };
    throw e;
  });
  const sc = (n: number) => n * scale;
  const font = style.fonts.docx;
  const body = sc(style.body);
  const line = Math.round((240 * style.leading) / 1.15);
  const textWidth = twips(PAGE_W - 2 * style.margin.x);

  let prev: Block | null = null;
  const lastHeader = blocks.reduce((last, b, i) => (b.kind === "name" || b.kind === "contact" ? i : last), -1);
  const headerRule = (i: number) => (style.headerRule && i === lastHeader ? { color: style.headerRule.color, width: style.headerRule.width } : undefined);
  const paras = blocks.map((b, i) => {
    let p: string;
    switch (b.kind) {
      case "name":
        p = paragraph(run(b.text, font, { bold: true, size: sc(style.name.size), color: style.name.color }), {
          align: style.name.align,
          after: sc(2),
          rule: headerRule(i),
          line,
        });
        break;
      case "contact":
        p = paragraph(run(b.text, font, { size: sc(style.contact.size), color: style.contact.color }), {
          align: style.contact.align,
          after: i === lastHeader && style.headerRule ? sc(4) : 0,
          rule: headerRule(i),
          line,
        });
        break;
      case "heading": {
        const h = style.heading;
        p = paragraph(run(headingText(b.text, style), font, { bold: true, size: sc(h.size), color: h.color }), {
          before: sc(h.before),
          after: sc(h.after),
          rule: h.rule ? { color: h.rule, width: h.ruleWidth } : undefined,
          keepNext: true,
          line,
        });
        break;
      }
      case "entry": {
        const left = run(b.left, font, { bold: b.level === "primary", italic: b.level === "secondary" && style.secondaryItalic, size: body });
        const right = b.right ? TAB_RUN + run(b.right, font, { italic: style.right.italic, size: body, color: style.right.color }) : "";
        const before = b.level === "primary" && prev && prev.kind !== "heading" ? sc(style.entryBefore) : 0;
        p = paragraph(left + right, { before, rightTab: textWidth, keepNext: true, line });
        break;
      }
      case "bullet":
        p = paragraph(run("•", font, { size: body }) + TAB_RUN + run(b.text, font, { size: body }), {
          before: prev?.kind === "entry" ? sc(style.bullet.before) : 0,
          indent: { left: sc(style.bullet.indent), hanging: sc(style.bullet.indent - style.bullet.glyphX) },
          line,
        });
        break;
      case "labeled":
        p = paragraph(run(`${b.label}:`, font, { bold: true, size: body }) + run(` ${b.text}`, font, { size: body }), { line });
        break;
      default:
        p = paragraph(run(b.text, font, { size: body }), { line });
    }
    prev = b;
    return p;
  });

  const m = { x: twips(style.margin.x), y: twips(sc(style.margin.y)) };
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${m.y}" w:right="${m.x}" w:bottom="${m.y}" w:left="${m.x}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;

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
