// The shape of an application packet, shared by the page and the server (no server-only code here).

import { z } from "zod";
import type { DecisionSummary } from "./decide";
import type { TailorResult } from "./tailor";
import type { InputWarning } from "./warnings";

export const PacketSchema = z.object({
  postingTitle: z.string().max(300),
  posting: z.string().max(20_000),
  resume: z.string().min(1).max(50_000),
  decision: z.enum(["apply", "skip", "needs_human"]),
  coverage: z.number().min(0).max(1).nullable(),
  warnings: z.array(z.object({ kind: z.enum(["injection", "invisible_text", "scam"]), input: z.enum(["posting", "resume", "notes"]), quote: z.string().max(400) })).max(50),
  flags: z.number().int().min(0).max(100),
  personOnly: z.array(z.string().max(500)).max(30),
  mode: z.enum(["ai", "simulated"]),
});

export type Packet = z.infer<typeof PacketSchema>;

/** Builds the packet for one job from its decision and tailored resume. */
export function buildPacket(args: {
  postingTitle: string;
  posting: string;
  decide: Pick<DecisionSummary, "decision" | "coverage" | "personOnly"> & { warnings: InputWarning[] };
  tailor: Pick<TailorResult, "tailored" | "kept">;
  mode: "ai" | "simulated";
}): Packet {
  return {
    postingTitle: args.postingTitle,
    posting: args.posting,
    resume: args.tailor.tailored,
    decision: args.decide.decision,
    coverage: args.decide.coverage,
    warnings: args.decide.warnings,
    flags: args.tailor.kept.filter((k) => k.review && k.review.length > 0).length,
    personOnly: args.decide.personOnly,
    mode: args.mode,
  };
}
