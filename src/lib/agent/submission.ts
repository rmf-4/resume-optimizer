// Approval, the mock application site, and level 3 (REQ-AG-24 to REQ-AG-35). Packets are never stored: the
// server keeps only each packet's content hash with its approval, and the mock site's log keeps hashes and who
// answered what, never the resume (SEC-AG-07). Every submission goes to the team's mock site and nowhere else
// (REQ-AG-32, NG-26).

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Store } from "@/lib/store";
import { check } from "./check";
import { composeSource } from "./run";
import type { Packet } from "./packetShape";

export type { Packet } from "./packetShape";

export type LogEntry = {
  id: string;
  at: string;
  packetHash: string;
  postingTitle: string;
  level: 2 | 3;
  approver: string;
  form: "simple" | "full";
  answeredBy: { question: string; by: "person" }[];
  outcome: "submitted" | "rejected";
  reason?: string;
};

const DAY = 24 * 60 * 60;
const KEEP_SECONDS = 7 * DAY; // SEC-AG-07
const LOG_KEY = "mock:log";
const LOG_MAX = 500;
const PASS_FAIL_LIMIT = 5;
const PASS_FAIL_WINDOW = 15 * 60; // SEC-AG-10
const LEVEL3_SECONDS = 60 * 60;

export function packetHash(p: Packet): string {
  const canonical = JSON.stringify([
    p.postingTitle,
    p.posting,
    p.resume,
    p.decision,
    p.coverage,
    p.warnings.map((w) => [w.kind, w.input, w.quote]),
    p.flags,
    p.personOnly,
    p.mode,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type PasscodeResult = { ok: true } | { ok: false; code: "not_configured" | "wrong_passcode" | "too_many_attempts"; message: string };

/** Constant-time passcode check with a lockout after 5 wrong tries in 15 minutes per visitor (SEC-AG-10). */
export async function checkPasscode(store: Store, ip: string, given: unknown, secret: string | undefined): Promise<PasscodeResult> {
  if (!secret) return { ok: false, code: "not_configured", message: "Approval isn't set up on this site yet: the AGENT_PASSCODE secret is missing." };
  const failKey = `passfail:${ip}`;
  const fails = Number((await store.get(failKey)) ?? 0);
  if (fails >= PASS_FAIL_LIMIT) return { ok: false, code: "too_many_attempts", message: "Too many wrong passcodes. Try again in 15 minutes." };
  if (typeof given !== "string" || !sameSecret(given, secret)) {
    await store.incr(failKey, PASS_FAIL_WINDOW);
    return { ok: false, code: "wrong_passcode", message: "That passcode isn't right." };
  }
  return { ok: true };
}

export type ApprovalRecord = { approver: string; at: string; level: 2 | 3 };

/**
 * Approves a packet (REQ-AG-26, REQ-AG-27): the whole resume must pass the checker against the source facts
 * first (REQ-AG-22), and the approval is stored against the packet's hash for 7 days.
 */
export async function approvePacket(args: {
  store: Store;
  packet: Packet;
  resumeText: string;
  notes?: string;
  approver: string;
  level: 2 | 3;
}): Promise<{ ok: true; packetHash: string } | { ok: false; code: "not_supported"; message: string; findings: { type: string; text: string }[] }> {
  const findings = check({ candidate: args.packet.resume, source: composeSource(args.resumeText, args.notes) });
  if (findings.length > 0) {
    return { ok: false, code: "not_supported", message: "This resume has text your resume and notes don't support, so it can't be approved.", findings };
  }
  const hash = packetHash(args.packet);
  const record: ApprovalRecord = { approver: args.approver, at: new Date().toISOString(), level: args.level };
  await args.store.set(`approval:${hash}`, JSON.stringify(record), { ttlSeconds: KEEP_SECONDS });
  return { ok: true, packetHash: hash };
}

export type SubmitResult =
  | { ok: true; entry: LogEntry }
  | { ok: false; status: 403 | 409 | 422; code: "approval_required" | "already_submitted" | "answers_required"; message: string; entry: LogEntry };

/**
 * The mock employer's application endpoint (REQ-AG-33, REQ-AG-34). It accepts a packet only with a matching,
 * unused approval, and for a full form only when a person answered every person-only question (REQ-AG-26).
 * Every attempt is logged (REQ-AG-35).
 */
export async function submitToMockSite(args: { store: Store; packet: Packet; answers: Record<string, string> }): Promise<SubmitResult> {
  const { store, packet } = args;
  const hash = packetHash(packet);
  const approval = await store.get(`approval:${hash}`);
  const record = approval ? (JSON.parse(approval) as ApprovalRecord) : null;
  const form = packet.personOnly.length > 0 ? "full" : "simple";
  const entry: LogEntry = {
    id: randomBytes(6).toString("hex"),
    at: new Date().toISOString(),
    packetHash: hash.slice(0, 16),
    postingTitle: packet.postingTitle.slice(0, 120),
    level: record?.level ?? 2,
    approver: record?.approver ?? "(none)",
    form,
    answeredBy: packet.personOnly.map((q) => ({ question: q.slice(0, 160), by: "person" as const })),
    outcome: "rejected",
  };
  const reject = async (status: 403 | 409 | 422, code: "approval_required" | "already_submitted" | "answers_required", message: string): Promise<SubmitResult> => {
    entry.reason = code;
    await store.pushCapped(LOG_KEY, JSON.stringify(entry), LOG_MAX);
    return { ok: false, status, code, message, entry };
  };

  if (!record) return reject(403, "approval_required", "This application hasn't been approved, so the mock site refused it.");
  const unanswered = packet.personOnly.filter((q) => !(args.answers[q] ?? "").trim());
  if (unanswered.length > 0) {
    // Level 3 never reaches here with person-only questions (REQ-AG-31); at level 2 a person must answer them.
    return reject(422, "answers_required", "Every question only you can answer needs your answer before submitting.");
  }
  const first = await store.set(`used:${hash}`, entry.id, { ttlSeconds: KEEP_SECONDS, nx: true });
  if (!first) return reject(409, "already_submitted", "This exact application was already submitted.");

  entry.outcome = "submitted";
  await store.pushCapped(LOG_KEY, JSON.stringify(entry), LOG_MAX);
  return { ok: true, entry };
}

export async function readLog(store: Store, limit = 100): Promise<LogEntry[]> {
  return (await store.range(LOG_KEY, 0, limit - 1)).map((s) => JSON.parse(s) as LogEntry);
}

/** A level 3 session, started by a person with the passcode (REQ-AG-30). API callers can't start one without it. */
export async function startLevel3(store: Store): Promise<{ token: string; expiresInSeconds: number }> {
  const token = randomBytes(24).toString("hex");
  await store.set(`level3:${token}`, "1", { ttlSeconds: LEVEL3_SECONDS });
  return { token, expiresInSeconds: LEVEL3_SECONDS };
}

export async function level3Active(store: Store, token: unknown): Promise<boolean> {
  return typeof token === "string" && /^[0-9a-f]{48}$/.test(token) && (await store.get(`level3:${token}`)) !== null;
}

/**
 * Why level 3 must stop and hand this packet to a person, or null if it may submit on its own (REQ-AG-31):
 * the decision must be apply, with no warnings, no rewrite needing confirmation, and no person-only question.
 */
export function level3StopReason(p: Packet): string | null {
  if (p.decision !== "apply") return `The decision was ${p.decision === "skip" ? "skip" : "needs a human"}, not apply.`;
  if (p.warnings.length > 0) return "There's a warning on this posting or your inputs.";
  if (p.flags > 0) return `${p.flags} rewrite${p.flags === 1 ? "" : "s"} need${p.flags === 1 ? "s" : ""} you to confirm ${p.flags === 1 ? "it's" : "they're"} true.`;
  if (p.personOnly.length > 0) return "The application asks questions only you can answer.";
  return null;
}
