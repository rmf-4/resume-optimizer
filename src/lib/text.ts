// Deterministic text helpers used by the Step 1 guards (REQ-GEN-04, REQ-GEN-05, REQ-S1-02).

const SUFFIXES = ["ational", "ations", "ation", "ments", "ment", "ings", "ing", "ies", "ied", "ers", "er", "es", "ed", "al", "ly", "s"];

/** A small suffix-stripping stemmer. It only needs to be consistent, because both sides of every comparison go through it. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length <= 3) return w;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  for (const suffix of SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length);
      if (suffix === "ies" || suffix === "ied") w += "y";
      break;
    }
  }
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Lower-cases and splits text into word tokens, keeping skill names such as "c++", "c#" and "node.js" intact. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? [];
}

function stems(text: string): string[] {
  return tokenize(text).map(stem);
}

function indexOfSequence(haystack: string[], needle: string[], from = 0): number {
  if (needle.length === 0) return -1;
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** True if `phrase` occurs in `text` as adjacent words, ignoring case and word endings. */
export function containsPhrase(text: string, phrase: string): boolean {
  return indexOfSequence(stems(text), stems(phrase)) !== -1;
}

/** Counts how often `phrase` occurs in `text` (same matching rules as containsPhrase). */
export function countPhrase(text: string, phrase: string): number {
  const hay = stems(text);
  const needle = stems(phrase);
  let count = 0;
  let at = indexOfSequence(hay, needle);
  while (at !== -1) {
    count++;
    at = indexOfSequence(hay, needle, at + needle.length);
  }
  return count;
}

export type Bullet = { id: number; text: string };

const BULLET_MARKER = /^[•▪◦‣∙·●○■□➢➤►✓✔\-*–—]\s+/;
const MARKER_ONLY = /^[•▪◦‣∙·●○■□➢➤►✓✔\-*–—]$/;
const MIN_FALLBACK_WORDS = 6;

/**
 * Finds the resume's bullet points. Lines starting with a bullet marker win; if there are none,
 * any line of 6+ words is treated as a bullet. Each bullet's text is an exact substring of the input.
 */
export function findBullets(resumeText: string): Bullet[] {
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim());
  let found: string[] = [];
  lines.forEach((line, i) => {
    if (BULLET_MARKER.test(line)) found.push(line.replace(BULLET_MARKER, "").trim());
    // A marker alone on its line introduces the next line.
    else if (MARKER_ONLY.test(line) && lines[i + 1] && !MARKER_ONLY.test(lines[i + 1])) found.push(lines[i + 1]);
  });
  if (found.length === 0) {
    found = lines.filter((l) => l.split(/\s+/).length >= MIN_FALLBACK_WORDS && !l.endsWith(":"));
  }
  return found.filter((t) => t.length > 0).map((text, i) => ({ id: i + 1, text }));
}
