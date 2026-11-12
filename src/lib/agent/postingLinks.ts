// Posting links (REQ-AG-05, changed 2026-11-12; A-63). Only links to four job boards are accepted, and only
// through each board's public posting API. The server never fetches the URL the user typed: it pulls out the
// board, organisation and posting ID with strict patterns and builds the API address itself, so no input can
// point the server anywhere else (SEC-WEB-05).

import { MAX_JD_CHARS } from "@/lib/limits";

export type Board = "greenhouse" | "lever" | "ashby" | "smartrecruiters";
export type BoardRef = { board: Board; org: string; id: string };
export type FetchedPosting = { title: string; company: string; text: string; board: Board; url: string };
export type LinkErrorCode = "unsupported_link" | "posting_not_found" | "fetch_failed" | "posting_too_long" | "posting_too_short";
export type LinkResult = { ok: true; posting: FetchedPosting } | { ok: false; code: LinkErrorCode; message: string };

export const SUPPORTED_BOARDS = "Greenhouse, Lever, Ashby and SmartRecruiters";

const ORG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const NUMERIC_ID = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a posting link. Returns null for anything that isn't a posting on one of the four boards. */
export function parsePostingUrl(raw: string): BoardRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    if (parts[0] === "embed") {
      const org = url.searchParams.get("for") ?? "";
      const id = url.searchParams.get("token") ?? "";
      return ORG.test(org) && NUMERIC_ID.test(id) ? { board: "greenhouse", org, id } : null;
    }
    const [org, jobs, id] = parts;
    return jobs === "jobs" && ORG.test(org ?? "") && NUMERIC_ID.test(id ?? "") ? { board: "greenhouse", org, id } : null;
  }
  if (host === "jobs.lever.co") {
    const [org, id] = parts;
    return ORG.test(org ?? "") && UUID.test(id ?? "") ? { board: "lever", org, id: id.toLowerCase() } : null;
  }
  if (host === "jobs.ashbyhq.com") {
    const [org, id] = parts;
    return ORG.test(org ?? "") && UUID.test(id ?? "") ? { board: "ashby", org, id: id.toLowerCase() } : null;
  }
  if (host === "jobs.smartrecruiters.com") {
    const [org, slug] = parts;
    const id = /^(\d{1,20})(?:-|$)/.exec(slug ?? "")?.[1];
    return ORG.test(org ?? "") && id ? { board: "smartrecruiters", org, id } : null;
  }
  return null;
}

/** The public API address for a posting, built only from the parsed, validated parts. */
export function apiUrlFor(ref: BoardRef): string {
  const org = encodeURIComponent(ref.org);
  const id = encodeURIComponent(ref.id);
  switch (ref.board) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${org}/jobs/${id}`;
    case "lever":
      return `https://api.lever.co/v0/postings/${org}/${id}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=false`;
    case "smartrecruiters":
      return `https://api.smartrecruiters.com/v1/companies/${org}/postings/${id}`;
  }
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", trade: "™", reg: "®", copy: "©",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Turns posting HTML into plain text with list items as "- " lines. Handles HTML that arrives entity-escaped. */
export function htmlToText(html: string): string {
  let h = html;
  if (!h.includes("<") && h.includes("&lt;")) h = decodeEntities(h);
  h = h
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section|table)>/gi, "\n")
    .replace(/<(h[1-6]|p|ul|ol|div|section|table)(\s[^>]*)?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(h)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Reads the title, company and full text out of one board's API response. Null if the posting isn't in it. */
export function postingFromApi(ref: BoardRef, data: unknown): { title: string; company: string; body: string } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Json;
  switch (ref.board) {
    case "greenhouse":
      return { title: str(d.title), company: str(d.company_name) || ref.org, body: htmlToText(str(d.content)) };
    case "lever": {
      const lists = Array.isArray(d.lists) ? (d.lists as Json[]) : [];
      const listText = lists.map((l) => `${str(l.text)}\n${htmlToText(str(l.content))}`).join("\n\n");
      const body = [str(d.descriptionPlain) || htmlToText(str(d.description)), listText, str(d.additionalPlain)].filter(Boolean).join("\n\n");
      return { title: str(d.text), company: ref.org, body };
    }
    case "ashby": {
      const jobs = Array.isArray(d.jobs) ? (d.jobs as Json[]) : [];
      const job = jobs.find((j) => str(j.id).toLowerCase() === ref.id);
      if (!job) return null;
      return { title: str(job.title).trim(), company: ref.org, body: str(job.descriptionPlain) || htmlToText(str(job.descriptionHtml)) };
    }
    case "smartrecruiters": {
      const sections = ((d.jobAd as Json | undefined)?.sections ?? {}) as Record<string, Json>;
      const body = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
        .map((k) => sections[k])
        .filter((sec) => sec && str(sec.text))
        .map((sec) => `${str(sec.title)}\n${htmlToText(str(sec.text))}`)
        .join("\n\n");
      return { title: str(d.name), company: str((d.company as Json | undefined)?.name) || ref.org, body };
    }
  }
}

const UNSUPPORTED = `Only links to job pages on ${SUPPORTED_BOARDS} can be read. For LinkedIn, Indeed, Handshake or a company's own careers site, copy the posting text and paste it instead.`;
const MAX_RESPONSE_CHARS = 5_000_000;
const FETCH_TIMEOUT_MS = 10_000;

/** Fetches one posting through its board's public API. `fetchFn` is injectable so tests never touch the network. */
export async function fetchPosting(raw: string, fetchFn: typeof fetch = fetch): Promise<LinkResult> {
  const ref = parsePostingUrl(raw);
  if (!ref) return { ok: false, code: "unsupported_link", message: UNSUPPORTED };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let data: unknown;
  try {
    const res = await fetchFn(apiUrlFor(ref), { signal: controller.signal, redirect: "error", headers: { accept: "application/json" } });
    if (res.status === 404) return { ok: false, code: "posting_not_found", message: "That posting wasn't found. It may have closed; paste the text if you still have it." };
    if (!res.ok) return { ok: false, code: "fetch_failed", message: "The job board didn't answer. Try again, or paste the posting text." };
    const text = await res.text();
    if (text.length > MAX_RESPONSE_CHARS) return { ok: false, code: "fetch_failed", message: "The job board's answer was too large to read. Paste the posting text instead." };
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: "fetch_failed", message: "The job board didn't answer. Try again, or paste the posting text." };
  } finally {
    clearTimeout(timer);
  }

  const posting = postingFromApi(ref, data);
  if (!posting) return { ok: false, code: "posting_not_found", message: "That posting wasn't found. It may have closed; paste the text if you still have it." };
  const text = [posting.title, posting.company, "", posting.body].join("\n").trim();
  if (text.length > MAX_JD_CHARS) {
    return { ok: false, code: "posting_too_long", message: "This posting is longer than 20,000 characters. Paste the part with the role and requirements instead." };
  }
  if (posting.body.trim().length < 100) {
    return { ok: false, code: "posting_too_short", message: "The job board returned almost no text for this posting. Paste the text instead." };
  }
  return { ok: true, posting: { title: posting.title, company: posting.company, text, board: ref.board, url: raw.trim() } };
}
