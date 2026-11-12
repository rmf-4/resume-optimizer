// Agent thresholds (AGENT_SPEC.md REQ-AG-09, REQ-AG-10, REQ-AG-38). Pre-registered: change only with a logged reason.

/** Coverage at or above this is "apply" (A-44). */
export const APPLY_AT = 0.7;
/** Coverage below this is "skip" (A-44). */
export const SKIP_BELOW = 0.4;
/** Fewer checkable must-haves than this goes to a human (A-44). */
export const MIN_MUST_HAVES = 3;

/** Per-attempt model timeout for agent steps, so two steps with retries fit in 300 s (A-43). */
export const AGENT_AI_TIMEOUT_MS = 60_000;
/** Requirements kept per posting; anything past this is ignored. */
export const MAX_REQUIREMENTS = 30;
/** Evidence quotes kept per requirement. */
export const MAX_EVIDENCE = 3;
