// Input limits from docs/STORY_1.md (REQ-IN-01, REQ-IN-03, REQ-IN-06, REQ-IN-07, REQ-S1-01).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PAGES = 10;
export const MIN_PDF_TEXT_CHARS = 200;
export const MIN_JD_CHARS = 300;
export const MAX_JD_CHARS = 20_000;
export const MAX_RESUME_CHARS = 50_000;

// DOCX container limits (SEC-FILE-04).
export const MAX_DOCX_EXPANDED_BYTES = 50 * 1024 * 1024;
export const MAX_DOCX_ENTRIES = 1_000;
export const MAX_DOCX_COMPRESSION_RATIO = 100;

// Step 1 output bounds (REQ-GEN-03, REQ-GEN-05).
export const MIN_KEYWORDS = 8;
export const MAX_KEYWORDS = 12;
export const WEAK_BULLET_COUNT = 3;

// AI call (REQ-ERR-01, SEC-LLM-09).
export const AI_TIMEOUT_MS = 120_000;
export const AI_MAX_OUTPUT_TOKENS = 8_000;

// Abuse limits (SEC-WEB-04, SEC-ABUSE-01).
export const ANALYSES_PER_HOUR_PER_VISITOR = 10;
export const DEFAULT_DAILY_ANALYSIS_CAP = 200;
export const UPLOADS_PER_HOUR_PER_VISITOR = 30;
