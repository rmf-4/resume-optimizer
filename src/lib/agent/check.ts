// The agent's checker (REQ-AG-18, REQ-AG-19). Plain code, no model call: the same inputs always
// give the same findings. It compares candidate text with the source facts and reports anything
// the source facts don't support. It matches patterns, not meaning (see AGENT_SPEC.md §6).

import { stem, tokenize } from "@/lib/text";
import { EMAIL, INVISIBLE, PHONE, URL_RE, trimTrailingPunct } from "./patterns";

export const FINDING_TYPES = [
  "new_number",
  "new_date",
  "new_name",
  "new_contact",
  "new_skill",
  "scope_change",
  "self_praise",
  "hidden_text",
] as const;

export type FindingType = (typeof FINDING_TYPES)[number];
export type Finding = { type: FindingType; text: string };

export type CheckInput = {
  /** The text being checked: one rewritten bullet, or the whole assembled resume. */
  candidate: string;
  /** Source facts: the client's confirmed resume text plus the coach's notes. */
  source: string;
  /** The posting. Used for `new_skill` when `gaps` isn't given. */
  posting?: string;
  /**
   * Requirements the source facts show no evidence for (the decide step's gaps). When given, `new_skill`
   * flags only words from these, not every word of the posting: long postings use most everyday words.
   */
  gaps?: string[];
  /**
   * Requirements the source facts do show. Their words never count as `new_skill`, even when a gap uses the
   * same word: "data" is fine when the client meets "data analysis", whatever "data visualization" says.
   */
  supported?: string[];
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

type Contact = { text: string; key: string; start: number; end: number };

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
      const found = trimTrailingPunct(m[0]);
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

/** Irregular verb forms, so "built" matches "build" and "led" matches "lead". */
const IRREGULAR: Record<string, string> = {
  built: "build", led: "lead", wrote: "write", written: "write", ran: "run", made: "make", drove: "drive", driven: "drive",
  grew: "grow", grown: "grow", taught: "teach", brought: "bring", sold: "sell", bought: "buy", won: "win", chose: "choose",
  chosen: "choose", spoke: "speak", spoken: "speak", gave: "give", given: "give", took: "take", taken: "take", met: "meet",
  kept: "keep", held: "hold", saw: "see", seen: "see", began: "begin", begun: "begin", sent: "send", spent: "spend",
  told: "tell", thought: "think", understood: "understand", oversaw: "oversee", overseen: "oversee", knew: "know",
  known: "know", paid: "pay", rose: "rise", drew: "draw", drawn: "draw", shown: "show", sought: "seek",
};

/** Stem after mapping irregular verb forms to their base. */
export function baseStem(word: string): string {
  const w = word.toLowerCase();
  return stem(IRREGULAR[w] ?? w);
}

/**
 * Everyday action verbs that rewording uses freely. They never count as a new skill on their own, even
 * when the posting uses them. Tools, nouns and skill terms are still checked ("dashboards", "forecasting").
 */
const GENERIC_VERB_BASES = (
  "achieve apply assist build collaborate communicate complete conduct contribute coordinate create deliver develop document " +
  "enable engage ensure execute expand facilitate generate handle help identify implement improve increase maintain " +
  "monitor organize partner perform plan prepare present produce provide reduce report resolve review run serve share " +
  "streamline support track update work write make take find"
).split(" ");

/** Every common form of each verb, stemmed, so stemmer quirks ("apply" vs "applying") can't split a family. */
function verbForms(base: string): string[] {
  const forms = [base, `${base}s`, `${base}ed`, `${base}ing`];
  if (base.endsWith("y")) forms.push(`${base.slice(0, -1)}ies`, `${base.slice(0, -1)}ied`);
  if (base.endsWith("e")) forms.push(`${base}d`, `${base.slice(0, -1)}ing`);
  return forms;
}

const GENERIC_VERBS = new Set(GENERIC_VERB_BASES.flatMap(verbForms).map((w) => baseStem(w)));

/**
 * The distinctive words of a requirement, stemmed: no stopwords, no everyday action verbs, at least 3 letters.
 * Used to measure how much of a posting's own wording a resume carries.
 */
export function contentStems(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((w) => w.length >= 3 && /[a-z]/.test(w) && !STOPWORDS.has(w))
        .map(baseStem)
        .filter((st) => !GENERIC_VERBS.has(st)),
    ),
  ];
}

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

// ---------- self-praise ----------

/** Words that grade the client instead of stating what they did. Allowed only if the original already uses them. */
const SELF_PRAISE =
  /\b(?:strong(?:ly)?|excellent|exceptional(?:ly)?|outstanding|proven|passionate|passion|highly|expert(?:ise)?|innovative|visionary|dynamic|motivated|self-driven|self-starter|results-driven|detail-oriented|talented|skilled|successfully|effectively|clearly|seamlessly|world-class|best-in-class|judg(?:e)?ment|adept|savvy|exemplary|communicator|team[- ]player|problem[- ]solver|hard[- ]?working|go-getter|quick learner|fast learner|people person|natural leader|thought leader|rock ?star|ninja|guru)\b/gi;

// ---------- hidden text ----------

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
  const sourceStems = new Set(sourceTokens.map(baseStem));
  const knownWord = (w: string) => sourceWords.has(w.toLowerCase()) || sourceStems.has(baseStem(w));

  // new_name
  const nameLike = new Set<Token>();
  tokens.forEach((t, i) => {
    if (isNameLike(t, i === 0 ? null : tokens[i - 1].end, masked)) nameLike.add(t);
  });
  for (const g of groupRuns(candidate, tokens, (t) => nameLike.has(t))) {
    if (g.tokens.some((t) => !knownWord(t.text))) add("new_name", g.text, g.at);
  }

  // new_skill
  const claimText = input.gaps ? input.gaps.join("\n") : input.posting;
  if (claimText) {
    const supportedStems = new Set(tokenize((input.supported ?? []).join("\n")).map(baseStem));
    const postingStems = new Set(
      tokenize(claimText)
        .filter((w) => !STOPWORDS.has(w))
        .map(baseStem)
        .filter((st) => !supportedStems.has(st)),
    );
    const isNewSkill = (t: Token) => {
      const w = t.text.toLowerCase();
      const s = baseStem(w);
      return /[a-z]/.test(w) && !STOPWORDS.has(w) && !GENERIC_VERBS.has(s) && postingStems.has(s) && !knownWord(w);
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

  // self_praise
  const praiseBaseline = (input.baseline ?? source).toLowerCase();
  for (const m of matchesOf(SELF_PRAISE, candidate)) {
    if (!praiseBaseline.includes(m[0].toLowerCase())) add("self_praise", m[0], m.index);
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
