// Input warnings for agent runs (SEC-AG-03, SEC-AG-04). Short, hand-written pattern lists (A-53):
// easy to evade by rewording, so they are a tripwire, not a defence on their own.

import { INVISIBLE } from "./patterns";

export type WarningKind = "injection" | "invisible_text" | "scam";
export type InputName = "posting" | "resume" | "notes";
export type InputWarning = { kind: WarningKind; input: InputName; quote: string };

export type AgentInputs = { posting: string; resume: string; notes?: string };

const INJECTION: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules|directions|guidelines)\b/i,
  /\bnew instructions?\b/i,
  /<\s*\/?\s*(?:system|instructions?|assistant|admin)\s*>/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\byou are (?:now )?(?:an?|the|in)\b[^.\n]{0,30}\b(?:ai|assistant|model|mode)\b/i,
  /\b(?:ai|llm|language models?|chatgpt|claude|gpt|assistants?|screening tools?|bots?)s?\b[^.\n]{0,60}\b(?:must|should|need to|please|are required to|are instructed to)\b/i,
  /\b(?:add|include|insert|mention|list)\b[^.\n]{0,60}\b(?:to|in|on|into)\s+(?:the|your|this)\s+(?:resume|cv|response|output|answer|summary|application)\b/i,
  /\b(?:rate|score|mark|classify|rank|flag)\b[^.\n]{0,30}\b(?:candidate|applicant|resume|application)s?\b[^.\n]{0,30}\b(?:perfect|qualified|strong|top|match|approved?)\b/i,
  /\b(?:white|invisible|hidden)\s+(?:text|font|ink)\b|\bkeyword[- ]stuff\w*/i,
];

const SCAM: RegExp[] = [
  /\bsocial security(?: number)?\b|\bSSN\b/i,
  /\bbank (?:account|routing|login|details|information)\b|\brouting number\b/i,
  /\b(?:driver'?s licen[cs]e|passport)\s+(?:number|copy|scan|photo)\b/i,
  /\b(?:upfront|up-front|registration|training|application|processing|equipment|onboarding|starter kit)\s+fees?\b/i,
  /\bgift cards?\b|\bwire transfer\b|\bwestern union\b|\bmoneygram\b|\bzelle\b|\bcrypto(?:currency)?\b|\bbitcoin\b/i,
  /\bcheck\b[^.\n]{0,30}\bdeposit\b|\bdeposit\b[^.\n]{0,30}\bcheck\b/i,
  /\btelegram\b|\bwhatsapp\b|\bsignal app\b/i,
];

const MAX_QUOTE = 200;

/** The sentence (or line) around a match, so the coach sees the context. Always a substring of `text`. */
function quoteAround(text: string, index: number, length: number): string {
  const isBreak = (c: string) => /[.!?\n]/.test(c);
  let start = index;
  while (start > 0 && !isBreak(text[start - 1])) start--;
  let end = index + length;
  while (end < text.length && !isBreak(text[end])) end++;
  let quote = text.slice(start, end).trim();
  if (quote.length > MAX_QUOTE) quote = text.slice(Math.max(start, index - 60), Math.min(end, index + length + 60)).trim();
  return quote;
}

function showInvisible(text: string): string {
  return text.replace(INVISIBLE, (c) => `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`);
}

/**
 * Strips invisible characters from every input and warns, with a quote, on invisible text,
 * prompt-injection patterns and scam signals. Patterns run on the cleaned text, so invisible
 * characters can't be used to split a phrase and slip past them.
 */
export function scanInputs(inputs: AgentInputs): { warnings: InputWarning[]; cleaned: AgentInputs } {
  const warnings: InputWarning[] = [];
  const seen = new Set<string>();
  const push = (w: InputWarning) => {
    const key = `${w.kind}|${w.input}|${w.quote}`;
    if (!seen.has(key)) {
      seen.add(key);
      warnings.push(w);
    }
  };

  const cleanedOf = (name: InputName, text: string): string => {
    const first = text.search(INVISIBLE);
    if (first !== -1) {
      const snippet = text.slice(Math.max(0, first - 30), Math.min(text.length, first + 40));
      push({ kind: "invisible_text", input: name, quote: showInvisible(snippet).trim() });
    }
    const cleaned = text.replace(INVISIBLE, "");
    for (const [kind, list] of [["injection", INJECTION], ["scam", SCAM]] as const) {
      for (const re of list) {
        const m = re.exec(cleaned);
        if (m) push({ kind, input: name, quote: quoteAround(cleaned, m.index, m[0].length) });
      }
    }
    return cleaned;
  };

  const cleaned: AgentInputs = {
    posting: cleanedOf("posting", inputs.posting),
    resume: cleanedOf("resume", inputs.resume),
  };
  if (inputs.notes !== undefined) cleaned.notes = cleanedOf("notes", inputs.notes);
  return { warnings, cleaned };
}
