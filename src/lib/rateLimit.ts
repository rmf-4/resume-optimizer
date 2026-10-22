/**
 * Fixed-window counter held in server memory (SEC-WEB-04, SEC-ABUSE-01).
 * On Vercel each instance keeps its own counts and loses them on restart, so this is best-effort only.
 */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(opts: { limit: number; windowMs: number; now?: () => number }) {
    this.limit = opts.limit;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Counts one use against `key`. Returns whether it was allowed and, if not, how long until the window resets. */
  take(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    if (this.buckets.size > 10_000) this.prune(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= this.limit) return { allowed: false, retryAfterSeconds };
    bucket.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number) {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key);
  }
}
