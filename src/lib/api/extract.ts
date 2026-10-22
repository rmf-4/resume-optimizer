import { extractResume, UploadError } from "@/lib/extract";
import { MAX_UPLOAD_BYTES, UPLOADS_PER_HOUR_PER_VISITOR } from "@/lib/limits";
import { RateLimiter } from "@/lib/rateLimit";
import { clientIp, errorResponse, FORBIDDEN_MESSAGE, json, originAllowed } from "./http";

// Multipart framing adds a little on top of the file itself.
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

export function createExtractHandler(deps: { limiter: RateLimiter }) {
  return async function extract(req: Request): Promise<Response> {
    if (!originAllowed(req)) return errorResponse(403, "forbidden", FORBIDDEN_MESSAGE);

    const limit = deps.limiter.take(clientIp(req));
    if (!limit.allowed) {
      return errorResponse(429, "rate_limited", "Too many uploads. Please wait and try again.", {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
      const e = new UploadError("too_large");
      return errorResponse(422, e.code, e.message);
    }

    let file: FormDataEntryValue | null;
    try {
      file = (await req.formData()).get("file");
    } catch {
      file = null;
    }
    if (!(file instanceof File) || file.size === 0) {
      const e = new UploadError("no_file");
      return errorResponse(400, e.code, e.message);
    }

    try {
      // The file is read into memory, parsed, and dropped. Nothing is written to disk or stored.
      const result = await extractResume(new Uint8Array(await file.arrayBuffer()));
      return json(result);
    } catch (e) {
      if (e instanceof UploadError) return errorResponse(e.code === "no_file" ? 400 : 422, e.code, e.message);
      // Log the error type only: messages from parsers can contain document text (SEC-DATA-03).
      console.error("extract: unexpected failure", e instanceof Error ? e.name : typeof e);
      return errorResponse(500, "internal", "Something went wrong reading this file. Please try again.");
    }
  };
}

export const handleExtract = createExtractHandler({
  limiter: new RateLimiter({ limit: UPLOADS_PER_HOUR_PER_VISITOR, windowMs: 60 * 60 * 1000 }),
});
