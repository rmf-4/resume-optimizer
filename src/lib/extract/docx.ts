import { strFromU8, unzipSync, type Unzipped } from "fflate";
import { MAX_DOCX_COMPRESSION_RATIO, MAX_DOCX_ENTRIES, MAX_DOCX_EXPANDED_BYTES } from "@/lib/limits";
import { UploadError } from "./errors";

// Entries smaller than this can't be a meaningful bomb, and tiny XML parts can legitimately compress very well.
const RATIO_CHECK_MIN_BYTES = 1024 * 1024;

/** Opens the ZIP container, enforcing the SEC-FILE-04 limits before anything is inflated. */
function unzipChecked(bytes: Uint8Array): { parts: Unzipped; names: string[] } {
  const names: string[] = [];
  let entries = 0;
  let expanded = 0;
  let limitHit = false;
  let parts: Unzipped;
  try {
    parts = unzipSync(bytes, {
      filter(file) {
        names.push(file.name);
        entries++;
        expanded += file.originalSize;
        const ratio = file.originalSize / Math.max(file.size, 1);
        if (
          entries > MAX_DOCX_ENTRIES ||
          expanded > MAX_DOCX_EXPANDED_BYTES ||
          (file.originalSize >= RATIO_CHECK_MIN_BYTES && ratio > MAX_DOCX_COMPRESSION_RATIO)
        ) {
          limitHit = true;
        }
        // Only XML parts are ever inflated; binary parts (images, embedded objects) are checked by name only.
        return !limitHit && /\.(xml|rels)$/i.test(file.name);
      },
    });
  } catch {
    throw new UploadError("unparseable");
  }
  if (limitHit) throw new UploadError("unsafe_docx");
  return { parts, names };
}

const EXTERNAL_ALLOWED_TYPE = /\/hyperlink$/;

function checkRelationships(xml: string) {
  for (const tag of xml.match(/<Relationship\b[^>]*>/g) ?? []) {
    if (!/TargetMode\s*=\s*["']External["']/i.test(tag)) continue;
    const type = /Type\s*=\s*["']([^"']*)["']/.exec(tag)?.[1] ?? "";
    if (!EXTERNAL_ALLOWED_TYPE.test(type)) throw new UploadError("external_content");
  }
}

/**
 * Validates a DOCX package and returns its body text (SEC-FILE-03..05, REQ-IN-05).
 * XML is never handed to a general-purpose parser: any part with a DTD is rejected outright,
 * and text is read with a small tokenizer that understands only the WordprocessingML tags it needs.
 */
export function extractDocx(bytes: Uint8Array): { text: string; hiddenText: string[] } {
  const { parts, names } = unzipChecked(bytes);

  if (!parts["[Content_Types].xml"] || !parts["word/document.xml"]) throw new UploadError("unsupported_type");

  const contentTypes = strFromU8(parts["[Content_Types].xml"]);
  if (/macroEnabled|vbaProject/i.test(contentTypes) || names.some((n) => /vbaProject\.bin$/i.test(n))) {
    throw new UploadError("macro_enabled");
  }

  const xmlParts: Record<string, string> = {};
  for (const [name, data] of Object.entries(parts)) {
    const xml = strFromU8(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new UploadError("unsafe_docx");
    xmlParts[name] = xml;
  }
  for (const [name, xml] of Object.entries(xmlParts)) {
    if (name.endsWith(".rels")) checkRelationships(xml);
  }

  return parseDocumentXml(xmlParts["word/document.xml"]);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? "";
  });
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`).exec(attrs)?.[1];
}

function isOn(attrs: string): boolean {
  const v = attr(attrs, "w:val");
  return v === undefined || !/^(0|false|off)$/i.test(v);
}

/** Colours whose every channel is at least 0xF0, i.e. white or close to it on a white page. */
function isNearWhite(hex: string | undefined): boolean {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return false;
  return [0, 2, 4].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 0xf0);
}

const TINY_HALF_POINTS = 8; // under 4 pt

function parseDocumentXml(xml: string): { text: string; hiddenText: string[] } {
  const lines: string[] = [];
  const hiddenText: string[] = [];

  let paraDepth = 0;
  let line = "";
  let isBullet = false;
  let hiddenPiece = "";
  let inPPr = false;
  let inRun = false;
  let inRPr = false;
  let inText = false;
  let runHidden = false;

  const flushHidden = () => {
    const piece = hiddenPiece.trim();
    if (piece) hiddenText.push(piece);
    hiddenPiece = "";
  };
  const append = (s: string) => {
    if (runHidden) {
      hiddenPiece += s;
    } else {
      if (s.trim()) flushHidden();
      line += s;
    }
  };

  const token = /<(\/?)([A-Za-z][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = token.exec(xml); m; m = token.exec(xml)) {
    const [, closing, tag, attrs, selfClosing, text] = m;
    if (text !== undefined) {
      if (inText) append(decodeEntities(text));
      continue;
    }
    const open = !closing;
    switch (tag) {
      case "w:p":
        if (open && !selfClosing) {
          if (paraDepth === 0) {
            line = "";
            isBullet = false;
          }
          paraDepth++;
        } else if (selfClosing) {
          if (paraDepth === 0) lines.push("");
        } else {
          paraDepth = Math.max(0, paraDepth - 1);
          if (paraDepth === 0) {
            flushHidden();
            const content = line.replace(/\s+$/, "");
            lines.push(isBullet && content.trim() ? `• ${content.trim()}` : content);
          }
        }
        break;
      case "w:pPr":
        inPPr = open && !selfClosing;
        break;
      case "w:numPr":
        if (inPPr && open) isBullet = true;
        break;
      case "w:r":
        inRun = open && !selfClosing;
        if (open) runHidden = false;
        break;
      case "w:rPr":
        inRPr = inRun && open && !selfClosing;
        break;
      case "w:vanish":
      case "w:specVanish":
        if (inRPr && open && isOn(attrs)) runHidden = true;
        break;
      case "w:color":
        if (inRPr && open && isNearWhite(attr(attrs, "w:val"))) runHidden = true;
        break;
      case "w:sz": {
        const size = Number(attr(attrs, "w:val"));
        if (inRPr && open && Number.isFinite(size) && size > 0 && size < TINY_HALF_POINTS) runHidden = true;
        break;
      }
      case "w:t":
        inText = open && !selfClosing;
        break;
      case "w:tab":
        if (inRun && open) append("\t");
        break;
      case "w:br":
      case "w:cr":
        if (inRun && open) append("\n");
        break;
    }
  }

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, hiddenText };
}
