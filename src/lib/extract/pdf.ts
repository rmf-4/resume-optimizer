import { extractTextItems, getDocumentProxy } from "unpdf";
import { MAX_PAGES, MIN_PDF_TEXT_CHARS } from "@/lib/limits";
import { UploadError } from "./errors";

const TINY_FONT_PT = 4;

type TextItem = { str: string; x: number; y: number; width: number; fontSize: number; hasEOL: boolean };
type Line = { text: string; x: number; y: number; fontSize: number; bulletTextX: number | null };

const MARKER = /^[•▪◦‣∙·●○■□➢➤►✓✔\-*–—]$/;

/** Joins two pieces of text on one line, adding a space only where the page shows a gap. */
function joinPieces(left: string, right: string, gap: number, fontSize: number): string {
  if (!left) return right;
  const needsSpace = gap > fontSize * 0.15 || MARKER.test(left.trim());
  return needsSpace && !/\s$/.test(left) && !/^\s/.test(right) ? `${left} ${right}` : left + right;
}

/**
 * Rebuilds lines from where text sits on the page (top to bottom, left to right) rather than the order
 * the PDF stores it, then rejoins bullet points that wrapped onto several lines. Many Word and Google Docs
 * exports store bullet glyphs and wrapped lines separately and out of order.
 */
function layoutLines(items: TextItem[]): string {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; fontSize: number; items: TextItem[] }[] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    const tolerance = 0.45 * Math.max(row?.fontSize ?? 0, item.fontSize);
    if (row && row.y - item.y <= tolerance) {
      row.items.push(item);
      row.fontSize = Math.max(row.fontSize, item.fontSize);
    } else {
      rows.push({ y: item.y, fontSize: item.fontSize, items: [item] });
    }
  }

  const lines: Line[] = rows.map((row) => {
    const parts = row.items.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd = -Infinity;
    for (const part of parts) {
      text = joinPieces(text, part.str, part.x - prevEnd, row.fontSize);
      prevEnd = part.x + part.width;
    }
    const startsWithMarker = MARKER.test(parts[0].str.trim());
    if (startsWithMarker && parts.length > 1) text = `• ${text.replace(/^\S+\s*/, "")}`;
    return {
      text: text.replace(/\s+$/, ""),
      x: parts[0].x,
      y: row.y,
      fontSize: row.fontSize,
      bulletTextX: startsWithMarker && parts.length > 1 ? parts[1].x : null,
    };
  });

  // Merge wrapped bullet lines: a non-bullet line that starts where the bullet's text started, directly below it.
  const merged: Line[] = [];
  let lastY = 0;
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    const isContinuation =
      prev?.bulletTextX != null &&
      line.bulletTextX === null &&
      !MARKER.test(line.text.split(/\s/)[0]) &&
      Math.abs(line.x - prev.bulletTextX) <= 2 &&
      lastY - line.y <= prev.fontSize * 1.8;
    if (isContinuation) {
      prev.text += /[A-Za-z]-$/.test(prev.text) ? line.text : ` ${line.text}`;
    } else {
      merged.push({ ...line });
    }
    lastY = line.y;
  }
  return merged.map((l) => l.text).join("\n");
}

/** Password-protected PDFs declare an /Encrypt dictionary in their trailer. */
function looksEncrypted(bytes: Uint8Array): boolean {
  return /\/Encrypt\b/.test(Buffer.from(bytes).toString("latin1"));
}

/**
 * Extracts text only (SEC-FILE-06): pdf.js never runs document JavaScript, follows actions,
 * or opens attachments here, and XFA forms are disabled. Tiny and off-page text is removed (REQ-IN-05).
 */
export async function extractPdf(bytes: Uint8Array): Promise<{ text: string; hiddenText: string[]; pageCount: number }> {
  if (looksEncrypted(bytes)) throw new UploadError("password_protected");

  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may take ownership of the buffer, so give it a copy.
    doc = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: true, disableFontFace: true });
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") throw new UploadError("password_protected");
    throw new UploadError("unparseable");
  }

  try {
    const pageCount = doc.numPages;
    if (pageCount > MAX_PAGES) throw new UploadError("too_many_pages");

    const views: number[][] = [];
    for (let i = 1; i <= pageCount; i++) views.push((await doc.getPage(i)).view);
    const { items } = await extractTextItems(doc);

    const hiddenText: string[] = [];
    const pages = items.map((pageItems, p) => {
      const [x0, y0, x1, y1] = views[p];
      const visible: TextItem[] = [];
      let hiddenPiece = "";
      const flushHidden = () => {
        if (hiddenPiece.trim()) hiddenText.push(hiddenPiece.trim());
        hiddenPiece = "";
      };
      for (const item of pageItems) {
        if (!item.str.trim()) continue;
        const offPage = item.x + item.width < x0 || item.x > x1 || item.y + item.fontSize < y0 || item.y > y1;
        const tiny = item.fontSize > 0 && item.fontSize < TINY_FONT_PT;
        if (offPage || tiny) {
          hiddenPiece += (hiddenPiece ? " " : "") + item.str;
          if (item.hasEOL) flushHidden();
          continue;
        }
        flushHidden();
        visible.push(item);
      }
      flushHidden();
      return layoutLines(visible);
    });

    const text = pages
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.replace(/\s/g, "").length < MIN_PDF_TEXT_CHARS) throw new UploadError("scanned_pdf");
    return { text, hiddenText, pageCount };
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("unparseable");
  } finally {
    await doc.loadingTask.destroy().catch(() => {});
  }
}
