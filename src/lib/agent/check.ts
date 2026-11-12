// The agent's checker (REQ-AG-18, REQ-AG-19). Plain code, no model call: the same inputs always
// give the same findings. It compares candidate text with the source facts and reports anything
// the source facts don't support. It matches patterns, not meaning (see AGENT_SPEC.md §6).

import { stem, tokenize } from "@/lib/text";

export const FINDING_TYPES = [
  "new_number",
  "new_date",
  "new_name",
  "new_contact",
  "new_skill",
  "scope_change",
  "hidden_text",
] as const;

export type FindingType = (typeof FINDING_TYPES)[number];
export type Finding = { type: FindingType; text: string };

export type CheckInput = {
  /** The text being checked: one rewritten bullet, or the whole assembled resume. */
  candidate: string;
  /** Source facts: the client's confirmed resume text plus the coach's notes. */
  source: string;
  /** The posting. Needed only for `new_skill`. */
  posting?: string;
  /** Text a leadership verb must already appear in: the original bullet plus the notes. Defaults to `source`. */
  baseline?: string;
};

type Located = Finding & { at: number };

// ---------- shared helpers ----------

/** Replaces each span with spaces of the same length, so later passes keep the same positions. */
function mask(text: string, spans: Array<[number, number]>): string {
  let out = text;
  for (const [start, end] of spans) out = out.slice(0, start) + " ".repeat(end - start) + out.slice(end);
  return out;
}

function matchesOf(re: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))];
}

const WORD = /[A-Za-z0-9][A-Za-z0-9+#.]*[A-Za-z0-9+#]|[A-Za-z0-9]/g;

type Token = { text: string; start: number; end: number };

function wordTokens(text: string): Token[] {
  return matchesOf(WORD, text).map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

/** Joins runs of flagged tokens separated only by spaces or tabs into one finding text. */
function groupRuns(original: string, tokens: Token[], flagged: (t: Token) => boolean): Array<{ text: string; at: number; tokens: Token[] }> {
  const groups: Array<{ start: number; end: number; tokens: Token[] }> = [];
  let current: { start: number; end: number; tokens: Token[] } | null = null;
  for (const t of tokens) {
    if (!flagged(t)) {
      current = null;
      continue;
    }
    if (current && /^[ \t]+$/.test(original.slice(current.end, t.start))) {
      current.end = t.end;
      current.tokens.push(t);
    } else {
      current = { start: t.start, end: t.end, tokens: [t] };
      groups.push(current);
    }
  }
  return groups.map((g) => ({ text: original.slice(g.start, g.end), at: g.start, tokens: g.tokens }));
}

// ---------- contacts ----------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+|\b(?:[A-Za-z0-9-]+\.)+(?:com|org|net|io|dev|ai|edu|co|me|app|gov|us)\b(?:\/[^\s<>()"']*)?/gi;
const PHONE = /(?<![\w])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

type Contact = { text: string; key: string; start: number; end: number };

function trimPunct(text: string): string {
  return text.replace(/[.,;:!?)\]]+$/, "");
}

function urlKey(text: string): string {
  return text.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

function phoneKey(text: string): string {
  const digits = text.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function extractContacts(text: string): { contacts: Contact[]; masked: string } {
  const contacts: Contact[] = [];
  let masked = text;
  const passes: Array<[RegExp, (s: string) => string]> = [
    [EMAIL, (s) => s.toLowerCase()],
    [URL_RE, urlKey],
    [PHONE, phoneKey],
  ];
  for (const [re, key] of passes) {
    for (const m of matchesOf(re, masked)) {
      const found = trimPunct(m[0]);
      if (!found) continue;
      contacts.push({ text: found, key: key(found), start: m.index, end: m.index + found.length });
    }
    masked = mask(masked, contacts.map((c) => [c.start, c.end]));
  }
  return { contacts, masked };
}

// ---------- dates ----------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_YEAR = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?,?\s+((?:19|20)\d{2})\b/gi;
const NUMERIC_MONTH_YEAR = /\b(0?[1-9]|1[0-2])\/((?:19|20)\d{2})\b/g;
const YEAR = /\b(?:19|20)\d{2}\b/g;

type DateHit = { text: string; key: string; start: number; end: number; kind: "month" | "year" };

function extractDates(text: string): { dates: DateHit[]; masked: string } {
  const dates: DateHit[] = [];
  for (const m of matchesOf(MONTH_YEAR, text)) {
    dates.push({ text: m[0], key: `${m[2]}-${MONTHS[m[1].toLowerCase()]}`, start: m.index, end: m.index + m[0].length, kind: "month" });
  }
  for (const m of matchesOf(NUMERIC_MONTH_YEAR, text)) {
    dates.push({ text: m[0], key: `${m[2]}-${Number(m[1])}`, start: m.index, end: m.index + m[0].length, kind: "month" });
  }
  let masked = mask(text, dates.map((d) => [d.start, d.end]));
  // Years inside a month-and-year still count as known years.
  const years: DateHit[] = dates.map((d) => {
    const y = d.key.slice(0, 4);
    return { text: y, key: y, start: d.start, end: d.end, kind: "year" };
  });
  const bare: DateHit[] = matchesOf(YEAR, masked).map((m) => ({ text: m[0], key: m[0], start: m.index, end: m.index + 4, kind: "year" }));
  masked = mask(masked, bare.map((d) => [d.start, d.end]));
  return { dates: [...dates, ...years, ...bare], masked };
}

// ---------- numbers ----------

const SCALE: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};
const DIGITS = /(?<![A-Za-z0-9.])\$?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s?(%|percent\b|x\b|k\b|mm\b|m\b|bn\b|b\b|thousand\b|million\b|billion\b))?(?![A-Za-z0-9])/gi;

const UNITS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, dozen: 12,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_NUMBER = new RegExp(
  `\\b(?:(${Object.keys(TENS).join("|")})(?:[-\\s](one|two|three|four|five|six|seven|eight|nine))?|(${Object.keys(UNITS).join("|")}))\\b(?:\\s(hundred|thousand|million|billion)\\b)?`,
  "gi",
);
const MAGNITUDE = /\b(?:hundreds|thousands|millions|billions|dozens)\b/gi;
const ONES: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

type NumberHit = { text: string; values: number[]; start: number; end: number; magnitude?: string };

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function extractNumbers(text: string): { numbers: NumberHit[]; masked: string } {
  const numbers: NumberHit[] = [];
  for (const m of matchesOf(WORD_NUMBER, text)) {
    const base = m[1] ? TENS[m[1].toLowerCase()] + (m[2] ? ONES[m[2].toLowerCase()] : 0) : UNITS[m[3].toLowerCase()];
    const scale = m[4] ? { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 }[m[4].toLowerCase()]! : 1;
    numbers.push({ text: m[0], values: [round(base * scale), base], start: m.index, end: m.index + m[0].length });
  }
  let masked = mask(text, numbers.map((n) => [n.start, n.end]));
  for (const m of matchesOf(MAGNITUDE, masked)) {
    numbers.push({ text: m[0], values: [], start: m.index, end: m.index + m[0].length, magnitude: m[0].toLowerCase() });
  }
  masked = mask(masked, numbers.map((n) => [n.start, n.end]));
  const digitHits: NumberHit[] = matchesOf(DIGITS, masked).map((m) => {
    const raw = Number(m[1].replace(/,/g, ""));
    const suffix = (m[2] ?? "").toLowerCase();
    const scaled = round(raw * (SCALE[suffix] ?? 1));
    return { text: m[0].trim(), values: [scaled, round(raw)], start: m.index, end: m.index + m[0].length };
  });
  numbers.push(...digitHits);
  masked = mask(masked, digitHits.map((n) => [n.start, n.end]));
  return { numbers, masked };
}

// ---------- names ----------

const SENTENCE_BREAK = /[.!?:;•▪*–—|\n]|(?:^|\s)-(?:\s|$)/;

function isNameLike(tok: Token, prevEnd: number | null, text: string): boolean {
  const t = tok.text;
  if (t.length < 2 || !/[A-Za-z]/.test(t)) return false;
  if (/[A-Z]/.test(t.slice(1))) return true; // SQL, PowerBI, iOS
  if (/\d/.test(t)) return true; // Q4, S3
  if (!/^[A-Z]/.test(t)) return false;
  const atSentenceStart = prevEnd === null || SENTENCE_BREAK.test(text.slice(prevEnd, tok.start));
  return !atSentenceStart;
}

// ---------- skills ----------

const STOPWORDS = new Set(
  (
    "a an the and or but nor of to in on for with at by from as is are was were be been being this that these those it its " +
    "our we you your their they them he she his her i me my us will would can could should may might must shall has have had " +
    "do does did not no than then so such into onto across over under per via who whom what which where when why how all any " +
    "each every more most other some up out about also plus etc if while both use used uses using within without between " +
    "experience year years skill skills strong ability role join looking responsibilities requirements preferred required " +
    "including new well work working"
  ).split(" "),
);

// ---------- scope ----------

const SCOPE_FAMILIES: string[][] = [
  ["lead", "leads", "leading", "led"],
  ["manage", "manages", "managed", "managing"],
  ["owned", "owns", "owning"],
  ["founded", "founding", "cofounded"],
  ["directed", "directing", "directs"],
  ["headed", "heading"],
  ["spearhead", "spearheads", "spearheaded", "spearheading"],
  ["oversee", "oversees", "oversaw", "overseeing", "overseen"],
  ["supervise", "supervises", "supervised", "supervising"],
  ["chaired", "chairing"],
  ["mentored", "mentoring"],
  ["drive", "drives", "drove", "driving", "driven"],
  ["orchestrated", "orchestrating"],
  ["architected", "architecting"],
  ["established", "establishing"],
  ["pioneered", "pioneering"],
  ["championed", "championing"],
];

// ---------- hidden text ----------

const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/gu;
const HIDE_INSTRUCTION =
  /\b(?:white|invisible|hidden)\s+(?:text|font|ink)\b|\bfont[- ]size\s*:?\s*0(?:\.\d+)?\s*(?:px|pt)?\b|\bdisplay\s*:\s*none\b|\bcolou?r\s*:\s*(?:#?fff(?:fff)?|white)\b|\bkeyword[- ]stuff\w*|\b(?:hide|hidden)\s+keywords?\b/gi;

// ---------- the checker ----------

export function check(input: CheckInput): Finding[] {
  const { candidate, source } = input;
  const found: Located[] = [];
  const add = (type: FindingType, text: string, at: number) => found.push({ type, text, at });

  // hidden_text runs on the raw candidate, before anything is masked.
  for (const m of matchesOf(INVISIBLE, candidate)) add("hidden_text", m[0], m.index);
  for (const m of matchesOf(HIDE_INSTRUCTION, candidate)) add("hidden_text", m[0], m.index);

  // new_contact
  const src = extractContacts(source);
  const cand = extractContacts(candidate);
  const knownContacts = new Set(src.contacts.map((c) => c.key));
  for (const c of cand.contacts) if (!knownContacts.has(c.key)) add("new_contact", c.text, c.start);

  // new_date
  const srcDates = extractDates(src.masked);
  const candDates = extractDates(cand.masked);
  const knownDates = new Set(srcDates.dates.map((d) => d.key));
  for (const d of candDates.dates) {
    // Synthetic year entries share the month-and-year span; the month entry already speaks for it.
    if (d.kind === "year" && candDates.dates.some((o) => o.kind === "month" && o.start === d.start)) continue;
    if (!knownDates.has(d.key)) add("new_date", d.text, d.start);
  }

  // new_number
  const srcNums = extractNumbers(srcDates.masked);
  const candNums = extractNumbers(candDates.masked);
  const knownValues = new Set(srcNums.numbers.flatMap((n) => n.values));
  const knownMagnitudes = new Set(srcNums.numbers.flatMap((n) => (n.magnitude ? [n.magnitude] : [])));
  for (const n of candNums.numbers) {
    const supported = n.magnitude ? knownMagnitudes.has(n.magnitude) : knownValues.has(n.values[0]);
    if (!supported) add("new_number", n.text, n.start);
  }

  // Everything below works on the candidate with contacts, dates and numbers blanked out.
  const masked = candNums.masked;
  const tokens = wordTokens(masked);
  const sourceTokens = tokenize(source);
  const sourceWords = new Set(sourceTokens);
  const sourceStems = new Set(sourceTokens.map(stem));
  const knownWord = (w: string) => sourceWords.has(w.toLowerCase()) || sourceStems.has(stem(w.toLowerCase()));

  // new_name
  const nameLike = new Set<Token>();
  tokens.forEach((t, i) => {
    if (isNameLike(t, i === 0 ? null : tokens[i - 1].end, masked)) nameLike.add(t);
  });
  for (const g of groupRuns(candidate, tokens, (t) => nameLike.has(t))) {
    if (g.tokens.some((t) => !knownWord(t.text))) add("new_name", g.text, g.at);
  }

  // new_skill
  if (input.posting) {
    const postingStems = new Set(tokenize(input.posting).filter((w) => !STOPWORDS.has(w)).map(stem));
    const isNewSkill = (t: Token) => {
      const w = t.text.toLowerCase();
      return /[a-z]/.test(w) && !STOPWORDS.has(w) && postingStems.has(stem(w)) && !knownWord(w);
    };
    for (const g of groupRuns(candidate, tokens, isNewSkill)) add("new_skill", g.text, g.at);
  }

  // scope_change
  const baselineStems = new Set(tokenize(input.baseline ?? source).map(stem));
  for (const t of tokens) {
    const w = t.text.toLowerCase();
    const family = SCOPE_FAMILIES.find((f) => f.includes(w));
    if (family && !family.some((form) => baselineStems.has(stem(form)))) add("scope_change", t.text, t.start);
  }

  const seen = new Set<string>();
  return found
    .sort((a, b) => FINDING_TYPES.indexOf(a.type) - FINDING_TYPES.indexOf(b.type) || a.at - b.at)
    .filter((f) => {
      const key = `${f.type}\u0000${f.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ type, text }) => ({ type, text }));
}
