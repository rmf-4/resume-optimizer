// A small, deterministic stand-in for the AI when no API key is set (REQ-AG-40). Every result it
// produces is labelled "simulated" and never counts as evaluation evidence. Its output goes through
// the same guards as the AI's.

import type { ModelResult } from "@/lib/step1/types";
import { stem, tokenize } from "@/lib/text";
import type { Requirement } from "./decide";
import type { AgentModel, DecideContext } from "./types";

const STOP = new Set(
  `a an the and or of to in on for with as at by from is are be will you your we our this that it its their who what such into
  across using use plus etc including within about over per all any each more most other some can may must should would able ability
  strong excellent good great years year experience experienced work working role team join looking skills skill knowledge
  understanding preferred required requirement requirements minimum least have has had do does similar related equivalent field`
    .split(/\s+/)
    .filter(Boolean),
);

const BULLET = /^\s*[•▪◦‣∙·●\-*–—]\s+/;
const PERSON = /authori[sz]|sponsor|relocat|salary|compensation expectation|background check|clearance|citizenship|willing(?:ness)? to travel|drug (?:test|screen)|on-?site|in-office|commut/i;
const CREDENTIAL = /\b(?:degree|bachelor'?s?|master'?s?|mba|ph\.?d|associates?|certifi\w*|licen[cs]\w*|cpa|pmp|cfa|series \d+)\b/i;
const NICE = /\b(?:plus|preferred|bonus|nice to have|desired|ideally)\b/i;

type Section = "req" | "pref" | "resp" | "other";

function sectionOf(heading: string): Section {
  if (/prefer|nice to have|bonus|plus/i.test(heading)) return "pref";
  if (/require|qualif|must|you have|about you|what you bring|skills|experience|education/i.test(heading)) return "req";
  if (/responsib|you'?ll do|what you will do|duties|the role/i.test(heading)) return "resp";
  return "other";
}

function contentStems(text: string): string[] {
  return [...new Set(tokenize(text).filter((w) => w.length >= 3 && !STOP.has(w) && /[a-z]/.test(w)).map(stem))];
}

function requirementLines(posting: string): Array<{ text: string; section: Section }> {
  const lines = posting.split(/\r?\n/);
  let section: Section = "other";
  const found: Array<{ text: string; section: Section }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isBullet = BULLET.test(line);
    if (!isBullet && (trimmed.endsWith(":") || trimmed.split(/\s+/).length <= 5)) {
      section = sectionOf(trimmed);
      continue;
    }
    if (isBullet || section === "req" || section === "pref") found.push({ text: trimmed.replace(BULLET, ""), section });
  }
  const qualifications = found.filter((f) => f.section === "req" || f.section === "pref");
  return qualifications.length > 0 ? qualifications : found.filter((f) => f.section === "resp");
}

function evidenceFor(requirement: string, sourceLines: string[]): string[] {
  const want = contentStems(requirement);
  if (want.length === 0) return [];
  const needed = want.length <= 2 ? 1 : 2;
  return sourceLines
    .map((line) => ({ line, hits: contentStems(line).filter((s) => want.includes(s)).length }))
    .filter((x) => x.hits >= needed)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map((x) => x.line);
}

export function simulateDecide(ctx: DecideContext): { requirements: Requirement[] } {
  const sourceLines = ctx.source
    .split(/\r?\n/)
    .map((l) => l.replace(BULLET, "").trim())
    .filter((l) => l.length > 0);
  const requirements: Requirement[] = [];
  for (const { text, section } of requirementLines(ctx.posting)) {
    for (const part of text.split(/;\s*/)) {
      const quote = part.replace(/[.;,:]+$/, "").trim();
      if (quote.length < 3) continue;
      const kind = PERSON.test(quote) ? "person" : CREDENTIAL.test(quote) ? "credential" : "skill";
      const priority = section === "pref" || NICE.test(quote) ? "nice" : "must";
      requirements.push({ quote, priority, kind, evidence: kind === "person" ? [] : evidenceFor(quote, sourceLines) });
    }
  }
  return { requirements };
}

export const simulatedModel: AgentModel = {
  mode: "simulated",
  async decide(_prompt, _signal, ctx): Promise<ModelResult> {
    return { type: "output", data: simulateDecide(ctx) };
  },
};
