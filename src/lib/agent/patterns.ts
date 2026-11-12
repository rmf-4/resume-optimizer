// Patterns shared by the checker (REQ-AG-19), contact redaction (SEC-AG-06) and input warnings (SEC-AG-03).

export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>()"']+|\b(?:[A-Za-z0-9-]+\.)+(?:com|org|net|io|dev|ai|edu|co|me|app|gov|us)\b(?:\/[^\s<>()"']*)?/gi;
export const PHONE = /(?<![\w])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/** Zero-width, bidi-control, soft-hyphen and tag characters: text a person can't see. */
export const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu;

/** Trailing punctuation that ends a sentence rather than a URL or email. */
export function trimTrailingPunct(text: string): string {
  return text.replace(/[.,;:!?)\]]+$/, "");
}
