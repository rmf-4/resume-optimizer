export type UploadErrorCode =
  | "no_file"
  | "unsupported_type"
  | "too_large"
  | "too_many_pages"
  | "password_protected"
  | "macro_enabled"
  | "external_content"
  | "unsafe_docx"
  | "unparseable"
  | "scanned_pdf"
  | "too_little_text"
  | "jd_too_short"
  | "jd_too_long";

/** What the uploaded file is meant to be, so messages name the right document. */
export type UploadSubject = "resume" | "job description";

const MESSAGES: Record<UploadErrorCode, (subject: UploadSubject) => string> = {
  no_file: () => "Choose a PDF or Word (.docx) file to upload.",
  unsupported_type: () => "Only PDF and Word (.docx) files are supported.",
  too_large: () => "This file is larger than 5 MB. Please upload a smaller file.",
  too_many_pages: (subject) => `This PDF has more than 10 pages. Please upload a ${subject} of 10 pages or fewer.`,
  password_protected: () => "This file is password-protected. Remove the password and upload it again.",
  macro_enabled: () => "This Word file contains macros. Save it as a regular .docx without macros and upload it again.",
  external_content: () =>
    "This Word file links to content on the internet (such as a remote template or linked image). Save a copy without external links and try again.",
  unsafe_docx: () => "This Word file has a structure we can't open safely. Re-save it as .docx from Word or Google Docs and try again.",
  unparseable: () => "We couldn't read this file. It may be damaged. Try saving it again and re-uploading.",
  scanned_pdf: () => "This looks like a scanned image; upload a text-based PDF or DOCX",
  too_little_text: (subject) => `We found almost no text in this file. Check that it's your ${subject} and try again.`,
  jd_too_short: () => "This job description is too short. Paste the full job posting (at least 300 characters).",
  jd_too_long: () => "The job description is longer than 20,000 characters. Please shorten it.",
};

/** A rejection the visitor can act on (REQ-IN-02). The message is safe to show as-is. */
export class UploadError extends Error {
  readonly code: UploadErrorCode;

  constructor(code: UploadErrorCode, subject: UploadSubject = "resume") {
    super(MESSAGES[code](subject));
    this.name = "UploadError";
    this.code = code;
  }
}
