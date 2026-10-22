import { MAX_JD_CHARS, MAX_UPLOAD_BYTES, MIN_JD_CHARS, MIN_PDF_TEXT_CHARS } from "@/lib/limits";
import { extractDocx } from "./docx";
import { UploadError } from "./errors";
import { extractPdf } from "./pdf";

export { UploadError } from "./errors";
export type { UploadErrorCode, UploadSubject } from "./errors";

export type ExtractResult = {
  fileType: "pdf" | "docx";
  text: string;
  hiddenText: string[];
  pageCount: number | null;
};

/** Decides the file type from its bytes alone (SEC-FILE-01). The filename and Content-Type are never consulted. */
export function sniffFileType(bytes: Uint8Array): "pdf" | "zip" | "unknown" {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  return "unknown";
}

/** Validates an uploaded resume and returns its plain text (REQ-IN-01..05). Nothing is stored. */
export async function extractResume(bytes: Uint8Array): Promise<ExtractResult> {
  if (bytes.byteLength === 0) throw new UploadError("no_file");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("too_large");

  const kind = sniffFileType(bytes);
  if (kind === "pdf") {
    const { text, hiddenText, pageCount } = await extractPdf(bytes);
    return { fileType: "pdf", text, hiddenText, pageCount };
  }
  if (kind === "zip") {
    const { text, hiddenText } = extractDocx(bytes);
    if (text.replace(/\s/g, "").length < MIN_PDF_TEXT_CHARS) throw new UploadError("too_little_text");
    return { fileType: "docx", text, hiddenText, pageCount: null };
  }
  throw new UploadError("unsupported_type");
}

/**
 * Validates an uploaded job description and returns its plain text (US-IN-2: REQ-IN-06, REQ-IN-07,
 * and REQ-IN-05a/06a/07a in requirements.md "Scope for HW3"). Same file rules and hidden-text
 * stripping as a resume; the text must then fit the job-description length limits. Nothing is stored.
 */
export async function extractJobDescription(bytes: Uint8Array): Promise<ExtractResult> {
  let result: ExtractResult;
  try {
    if (bytes.byteLength === 0) throw new UploadError("no_file");
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadError("too_large");
    const kind = sniffFileType(bytes);
    if (kind === "pdf") {
      const { text, hiddenText, pageCount } = await extractPdf(bytes);
      result = { fileType: "pdf", text, hiddenText, pageCount };
    } else if (kind === "zip") {
      const { text, hiddenText } = extractDocx(bytes);
      result = { fileType: "docx", text, hiddenText, pageCount: null };
    } else {
      throw new UploadError("unsupported_type");
    }
  } catch (e) {
    // Re-word the parser's rejection so it names a job description, not a resume.
    if (e instanceof UploadError) throw new UploadError(e.code, "job description");
    throw e;
  }
  const length = result.text.trim().length;
  if (length < MIN_JD_CHARS) throw new UploadError("jd_too_short", "job description");
  if (length > MAX_JD_CHARS) throw new UploadError("jd_too_long", "job description");
  return result;
}
