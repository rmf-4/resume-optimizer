import { MAX_KEYWORDS, WEAK_BULLET_COUNT } from "@/lib/limits";
import { containsPhrase, countPhrase } from "@/lib/text";
import type { KeywordCategory, ModelResult, Step1Context, Step1Model, Step1ModelOutput, WeakBulletReason } from "./types";

// A small, deterministic stand-in for the AI (REQ-S1-03). Its output goes through the same guards as the AI's.

const STOPWORDS = new Set(
  `a an the and or of to in on for with as at by from is are be will you your we our us this that these those it its their they who what which
  such into across using use plus etc including include within about over per all any each more most other some can may must should would
  able ability strong excellent good great years year experience experienced work working role team teams join looking seeking
  responsibilities requirements qualifications preferred required skills skill knowledge understanding own build maintain lead drive
  partner find write clear advanced new senior junior help helps support supports ensure ensuring day based both well also than
  have has had do does make makes like very highly ideal candidate candidates company opportunity opportunities position job apply equal employer
  among client clients individuals range roles chance difference success results growth culture ideas colleagues world leading really key
  deep prior close closely multiple fast paced environment equivalent talented accomplished play outperform challenge views identify
  skip content careers news search login privacy terms copyright rights reserved affiliates who about notice disclosures brand location
  race religion color gender pregnancy national origin age disability military veteran status sexual orientation genetic information
  classification protected federal state local laws consideration employment advancement regard without
  gain connecting connect develop manage deliver seek test accelerate create optimize enhance implement generate offer established
  allows rests operate tailored contribute empowered cultivated thrive`
    .split(/\s+/)
    .filter(Boolean),
);

const TOOLS = new Set(
  `sql python excel tableau power bi sap salesforce jira aws azure gcp docker kubernetes react javascript typescript java git figma hubspot
  looker snowflake oracle workday spss sas quickbooks netsuite erp crm slack asana confluence linux node.js c++ c# go ruby php html css
  terraform airflow spark hadoop mongodb postgresql mysql powerpoint outlook zendesk shopify adobe photoshop illustrator canva`
    .split(/\s+/)
    .filter(Boolean),
);
const MULTIWORD_TOOLS = ["power bi", "google analytics", "microsoft office", "ms office"];

const SOFT = [
  "communication", "leadership", "collaboration", "teamwork", "problem solving", "stakeholder", "mentoring", "adaptability",
  "time management", "negotiation", "presentation", "storytelling", "critical thinking", "attention to detail", "customer service",
  "relationship", "prioritization", "influence", "interpersonal",
];

const INDUSTRY = [
  "lean", "six sigma", "supply chain", "compliance", "gaap", "hipaa", "agile", "scrum", "b2b", "b2c", "saas", "kpi", "roi", "logistics",
  "procurement", "ecommerce", "e-commerce", "omnichannel", "continuous improvement", "distribution",
];

function categorize(phrase: string): KeywordCategory {
  const lower = phrase.toLowerCase();
  if (MULTIWORD_TOOLS.some((t) => lower.includes(t)) || lower.split(/\s+/).some((w) => TOOLS.has(w))) return "tool";
  if (SOFT.some((s) => lower.includes(s))) return "soft skill";
  if (INDUSTRY.some((s) => lower.includes(s))) return "industry term";
  return "hard skill";
}

/** Splits the JD into runs of adjacent content words, keeping the original casing. */
function contentChunks(text: string): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let lastEnd = 0;
  const word = /[A-Za-z0-9][A-Za-z0-9+#.]*[A-Za-z0-9+#]|[A-Za-z0-9]/g;
  for (let m = word.exec(text); m; m = word.exec(text)) {
    const gap = text.slice(lastEnd, m.index);
    lastEnd = m.index + m[0].length;
    const w = m[0];
    const isContent = !STOPWORDS.has(w.toLowerCase()) && w.length > 1 && !/^\d+$/.test(w);
    if (/[^ \t]/.test(gap) || !isContent) {
      if (current.length) chunks.push(current);
      current = [];
    }
    if (isContent) current.push(w);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const SINGLE_WORD_OK = (word: string) =>
  TOOLS.has(word.toLowerCase()) || /^[A-Z0-9]{2,}$/.test(word) || SOFT.includes(word.toLowerCase()) || INDUSTRY.includes(word.toLowerCase());

/** Every word capitalized, e.g. a company or place name, which is rarely a useful resume keyword. */
const looksLikeName = (phrase: string) => phrase.split(" ").every((w) => /^[A-Z][a-z]/.test(w));

function pickKeywords(ctx: Step1Context): Step1ModelOutput["keywords"] {
  const candidates = new Map<string, { phrase: string; score: number }>();
  for (const chunk of contentChunks(ctx.jobDescription)) {
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= chunk.length; i++) {
        const phrase = chunk.slice(i, i + n).join(" ");
        const key = phrase.toLowerCase();
        const existing = candidates.get(key);
        // Keep the lower-case spelling if the phrase also appears outside titles and names.
        if (existing) {
          if (looksLikeName(existing.phrase) && !looksLikeName(phrase)) {
            existing.score += 3;
            existing.phrase = phrase;
          }
          continue;
        }
        // Single words are too vague unless they're a known tool, acronym or skill.
        if (n === 1 && !SINGLE_WORD_OK(phrase)) continue;
        const category = categorize(phrase);
        let score = countPhrase(ctx.jobDescription, phrase);
        if (category === "tool") score += 3;
        if (category === "soft skill" || category === "industry term") score += 2;
        if (n >= 2) score += 1.5;
        if (/^[A-Z0-9]{2,}$/.test(phrase)) score += 1;
        if (category !== "tool" && looksLikeName(phrase)) score -= 3;
        if (!containsPhrase(ctx.resumeText, phrase)) score += 2;
        candidates.set(key, { phrase, score });
      }
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
  const picked: string[] = [];
  for (const { phrase } of ranked) {
    if (picked.length >= MAX_KEYWORDS - 2) break;
    const overlaps = picked.some((p) => containsPhrase(p, phrase) || containsPhrase(phrase, p));
    if (!overlaps) picked.push(phrase);
  }
  return picked.map((keyword) => ({ keyword, category: categorize(keyword) }));
}

const PASSIVE_START = /^(responsible for|helped|assisted|worked on|participated in|involved in|tasked with|duties included|was|were)\b/i;

function pickWeakBullets(ctx: Step1Context): Step1ModelOutput["weak_bullets"] {
  const scored = ctx.bullets.map((b) => {
    const passive = PASSIVE_START.exec(b.text);
    let reason: WeakBulletReason;
    let explanation: string;
    let score: number;
    if (passive) {
      reason = "passive phrasing";
      explanation = `It starts with "${passive[0]}", which describes a duty rather than what was achieved.`;
      score = 3;
    } else if (!/\d/.test(b.text)) {
      reason = "no measurable impact";
      explanation = "There is no number showing the scale or result of this work.";
      score = 2;
    } else {
      reason = "generic";
      explanation = "It is vague about what was done and why it mattered.";
      score = b.text.split(/\s+/).length <= 6 ? 1.5 : 1;
    }
    return { bullet_id: b.id, reason, explanation, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.bullet_id - b.bullet_id)
    .slice(0, Math.min(WEAK_BULLET_COUNT, ctx.bullets.length))
    .map(({ bullet_id, reason, explanation }) => ({ bullet_id, reason, explanation }));
}

export const demoModel: Step1Model = {
  mode: "demo",
  async generate(_prompt, _signal, ctx): Promise<ModelResult> {
    const data: Step1ModelOutput = { keywords: pickKeywords(ctx), weak_bullets: pickWeakBullets(ctx) };
    return { type: "output", data };
  },
};
