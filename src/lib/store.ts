// A tiny key-value store for approvals, the mock site's log and passcode throttling (A-47). On Vercel it's
// Upstash Redis over its REST API, so it survives restarts and is shared between instances; in tests, and
// locally without Upstash variables, it's an in-memory map.

export interface Store {
  get(key: string): Promise<string | null>;
  /** Sets a value. With `nx`, only if the key doesn't exist yet; returns false when it already did. */
  set(key: string, value: string, opts?: { ttlSeconds?: number; nx?: boolean }): Promise<boolean>;
  /** Adds one and returns the new count. The expiry is set when the key is created. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  del(key: string): Promise<void>;
  /** Adds to the front of a list and trims it to `max` entries. */
  pushCapped(key: string, value: string, max: number): Promise<void>;
  range(key: string, start: number, stop: number): Promise<string[]>;
}

export function memoryStore(now: () => number = Date.now): Store {
  const values = new Map<string, { value: string; expires: number | null }>();
  const lists = new Map<string, string[]>();
  const live = (key: string) => {
    const v = values.get(key);
    if (v && v.expires !== null && v.expires <= now()) values.delete(key);
    return values.get(key);
  };
  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, opts = {}) {
      if (opts.nx && live(key)) return false;
      values.set(key, { value, expires: opts.ttlSeconds ? now() + opts.ttlSeconds * 1000 : null });
      return true;
    },
    async incr(key, ttlSeconds) {
      const v = live(key);
      const n = (v ? Number(v.value) : 0) + 1;
      values.set(key, { value: String(n), expires: v?.expires ?? now() + ttlSeconds * 1000 });
      return n;
    },
    async del(key) {
      values.delete(key);
    },
    async pushCapped(key, value, max) {
      lists.set(key, [value, ...(lists.get(key) ?? [])].slice(0, max));
    },
    async range(key, start, stop) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
  };
}

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

/** Upstash Redis through its REST API. Keys are prefixed so this app can share a database safely. */
export function upstashStore(url: string, token: string, fetchFn: typeof fetch = fetch, prefix = "rpa:"): Store {
  async function call(command: (string | number)[]): Promise<unknown> {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    // Never include the command in the error: it can carry user data.
    if (!res.ok || !body || body.error) throw new StoreError(`Store request failed (${res.status})`);
    return body.result;
  }
  async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
    const res = await fetchFn(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
    if (!res.ok || !Array.isArray(body) || body.some((b) => b.error)) throw new StoreError(`Store request failed (${res.status})`);
    return body.map((b) => b.result);
  }
  const k = (key: string) => `${prefix}${key}`;
  return {
    async get(key) {
      const r = await call(["GET", k(key)]);
      return typeof r === "string" ? r : null;
    },
    async set(key, value, opts = {}) {
      const cmd: (string | number)[] = ["SET", k(key), value];
      if (opts.ttlSeconds) cmd.push("EX", opts.ttlSeconds);
      if (opts.nx) cmd.push("NX");
      return (await call(cmd)) === "OK";
    },
    async incr(key, ttlSeconds) {
      const [n] = await pipeline([
        ["INCR", k(key)],
        ["EXPIRE", k(key), ttlSeconds, "NX"],
      ]);
      return Number(n);
    },
    async del(key) {
      await call(["DEL", k(key)]);
    },
    async pushCapped(key, value, max) {
      await pipeline([
        ["LPUSH", k(key), value],
        ["LTRIM", k(key), 0, max - 1],
      ]);
    },
    async range(key, start, stop) {
      const r = await call(["LRANGE", k(key), start, stop]);
      return Array.isArray(r) ? r.map(String) : [];
    },
  };
}

let shared: Store | null = null;

/** Upstash when KV_REST_API_URL and KV_REST_API_TOKEN are set (Vercel, or .env.development.local); otherwise memory. */
export function defaultStore(): Store {
  if (!shared) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    shared = url && token ? upstashStore(url, token) : memoryStore();
  }
  return shared;
}
