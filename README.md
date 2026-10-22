# Resume Keyword Check

Upload a resume (PDF or Word), paste or upload a job description (PDF or Word), and get **Step 1: ATS & Keyword Gap Analysis**: the job's keywords your resume is missing, and your three weakest bullet points.

This is the first slice of the Resume & LinkedIn Optimizer. What it does and doesn't do is in [docs/STORY_1.md](docs/STORY_1.md). The full product spec is in [docs/](docs/).

## Non-goals (HW3 build rules)

- **No real payments.** There is no billing or card handling; Stripe (US-BILL-*) is out of scope.
- **No real authentication.** There are no accounts or sign-in; any visitor can use the app (US-AUTH-* is out of scope).
- **No database.** Nothing is stored. The only server state is the in-memory rate-limit and daily-cap counters, which reset on every deploy and whenever Vercel starts a new instance.

## Run it on your Mac

Open Terminal and run:

```bash
cd ~/Desktop/resume-optimizer-spec
npm install        # first time only
npm run dev
```

Then open http://localhost:3000. Press `Ctrl+C` in Terminal to stop it.

Without an API key the app runs in **demo mode**: a built-in, non-AI analyzer, clearly labelled on the page. To use real AI:

1. Create an API key at https://console.anthropic.com. API usage is billed there, separately from any Claude.ai plan.
2. Copy `.env.example` to `.env.local` and put the key after `ANTHROPIC_API_KEY=`.
3. Stop and restart `npm run dev`.

## Checks

```bash
npm test           # all automated tests
npm run typecheck  # TypeScript
npm run lint       # code style
npm run build      # production build
```

## Deploying to Vercel

Import the repository in Vercel. Under **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` (and optionally `DAILY_ANALYSIS_CAP`). Without a key the deployed site runs in demo mode.

Known limits on Vercel:
- Uploads over about 4.5 MB are rejected by Vercel itself, before they reach the app. The page shows a clear message when that happens.
- The rate limit (10 analyses per visitor per hour) and the daily cap live in server memory, so they reset whenever Vercel starts a new instance.

## Security spec audit

Audit of every requirement in [docs/SECURITY_SPEC.md](docs/SECURITY_SPEC.md) against the Story 1 build as of 2026-10-01. Story 1 has no accounts, no database, no payments and no exports, and it stores nothing (see [docs/STORY_1.md](docs/STORY_1.md)), so many requirements have nothing to apply to yet. Those are marked **Not at all**: the protection does not exist, even where the risk it covers doesn't exist yet either.

**Totals:** 17 Fully · 12 Partly · 43 Not at all (72 requirements).

| ID | Requirement (short) | Status | Why |
|---|---|---|---|
| SEC-AUTH-01 | Password policy and breached-password check | Not at all | No accounts or passwords exist in this build. |
| SEC-AUTH-02 | Argon2id/bcrypt password hashing | Not at all | No passwords are stored. |
| SEC-AUTH-03 | Sign-in back-off per account and per IP | Not at all | There is no sign-in. |
| SEC-AUTH-04 | No account enumeration via responses or timing | Not at all | There are no sign-up, sign-in or reset endpoints. |
| SEC-AUTH-05 | Strong, hashed, single-use, expiring tokens | Not at all | No verification or reset tokens exist. |
| SEC-AUTH-06 | Revoke sessions and notify on password/MFA change | Not at all | No passwords, MFA or sessions exist. |
| SEC-AUTH-07 | OAuth with PKCE, state, nonce, ID-token checks | Not at all | No OAuth sign-in exists. |
| SEC-AUTH-08 | Safe OAuth account linking | Not at all | No OAuth sign-in exists. |
| SEC-AUTH-09 | Encrypted TOTP secrets, hashed recovery codes, no replay | Not at all | No MFA exists. |
| SEC-AUTH-10 | Re-authentication for sensitive actions | Not at all | No accounts or sensitive account actions exist. |
| SEC-SESS-01 | Secure `__Host-` session cookie | Not at all | The app issues no cookies. |
| SEC-SESS-02 | 30-min idle / 12-h absolute session expiry | Not at all | No sessions exist. |
| SEC-SESS-03 | New session ID on sign-in and MFA | Not at all | No sessions exist. |
| SEC-SESS-04 | Reject state-changing requests without CSRF token or with bad Origin | Partly | Both POST endpoints return 403 for a mismatched `Origin` (tested), but there is no CSRF token and requests with no `Origin` header are allowed. |
| SEC-SESS-05 | Server-side sign-out | Not at all | No sessions exist. |
| SEC-AZ-01 | Server-side ownership check on every object | Not at all | Nothing is stored, so there are no objects or owners to check. |
| SEC-AZ-02 | 404 and audit event for cross-tenant access | Not at all | No tenants, stored objects or audit log exist. |
| SEC-AZ-03 | Tenant scoping at the data layer | Not at all | There is no database. |
| SEC-AZ-04 | Random UUIDv4 object IDs | Not at all | The app creates no object IDs. |
| SEC-AZ-05 | No standing staff access; audited break-glass | Partly | No content is stored, so there is nothing for staff to access, but no break-glass procedure is defined. |
| SEC-AZ-06 | Unverified/read-only limits enforced server-side | Not at all | Account states don't exist (the "text confirmed" check is enforced server-side, but that's REQ-IN-04). |
| SEC-FILE-01 | File type from magic bytes, not name or Content-Type | Fully | Type is decided from the file's bytes and ZIP contents only; tested with renamed and mislabelled files. |
| SEC-FILE-02 | Parse in a sandbox (no network, read-only FS, 30 s CPU, 512 MB) | Not at all | Files are parsed inside the main server process; only the hosting time limit (60 s) applies. |
| SEC-FILE-03 | DOCX XML with DTDs and external entities disabled | Fully | Any DOCX part containing a DOCTYPE or ENTITY is rejected before reading; no general XML parser is used (tested). |
| SEC-FILE-04 | DOCX zip-bomb limits (50 MB, 1,000 entries, 100:1) | Partly | All three limits are checked before inflating (tested), but the ratio check is skipped for entries under 1 MB and sizes are taken from the ZIP headers. |
| SEC-FILE-05 | Reject macros and external relationships; never fetch them | Fully | Macro content types and vbaProject parts are rejected, external non-hyperlink relationships are rejected, and nothing is fetched (tested). |
| SEC-FILE-06 | Ignore PDF JavaScript, attachments, actions, XFA | Fully | Only text is extracted, XFA is disabled, and a PDF with a JavaScript action is read with no network call (tested). |
| SEC-FILE-07 | Malware scan before storing | Not at all | There is no malware scanning (files are never stored). |
| SEC-FILE-08 | Private bucket, random keys, 5-minute signed URLs | Not at all | There is no file storage or download feature; uploads are discarded after reading. |
| SEC-FILE-09 | Only extracted, hidden-text-stripped, confirmed text goes to the AI | Partly | File bytes are never sent and hidden text is stripped at extraction, but the server trusts whatever text the browser submits as confirmed. |
| SEC-LLM-01 | Inputs in separately delimited data blocks | Fully | Resume, job description and bullets sit in separate tagged blocks, and look-alike tags in the input are neutralised (tested). |
| SEC-LLM-02 | No tools or retrieval; only this run's inputs | Fully | The request has no tools and contains only the current inputs (tested on the built request). |
| SEC-LLM-03 | Validate output against the schema before use | Fully | Output is schema-checked, then grounding, count and verbatim guards run before anything is shown (tested). |
| SEC-LLM-04 | Safe rendering: no raw HTML, no images, safe links | Fully | Achieved by a different method: no Markdown or HTML is rendered at all, and React shows all output as plain text (tested with XSS payloads). |
| SEC-LLM-05 | New URLs/emails/phones shown inert and marked "Unverified" | Partly | All output is inert plain text, but nothing detects or labels new URLs, emails or phone numbers. |
| SEC-LLM-06 | Warn on prompt-injection patterns in inputs | Not at all | Inputs are not scanned for injection patterns; the prompt only tells the model to treat inputs as data. |
| SEC-LLM-07 | API key only in server secrets, separate per environment | Partly | The key is read from a server environment variable and was confirmed absent from the browser bundle, but there is no secrets manager or per-environment key yet. |
| SEC-LLM-08 | Zero-data-retention and no-training terms with the AI provider | Not at all | Contract terms haven't been reviewed; they depend on the account the API key comes from. |
| SEC-LLM-09 | Reject input over 30k tokens; cap output at 8k | Partly | Output is capped at 8,000 tokens, but input is limited by characters (50,000 + 20,000), not by a token count. |
| SEC-LLM-10 | Strip hidden-text or stuffing instructions from output; invalidate run | Not at all | Output text is not checked for such instructions (Step 1's structured output limits what the model can return). |
| SEC-DATA-01 | TLS 1.2+, HSTS, HTTP→HTTPS redirect | Partly | The HSTS header (1 year, includeSubDomains) is sent; TLS and the redirect depend on Vercel and are unverified until deployed. |
| SEC-DATA-02 | AES-256 encryption at rest with KMS keys | Not at all | There is no database, storage or backup to encrypt. |
| SEC-DATA-03 | No document text, secrets or cookies in logs | Fully | App code logs only error type names, never messages or content (canary test); hosting-platform logs not yet reviewed. |
| SEC-DATA-04 | AI request/response bodies never logged | Fully | The AI request and response are never logged or stored. |
| SEC-DATA-05 | Delete derived artefacts and write a deletion receipt | Not at all | Nothing is stored, so no deletion process or receipts exist. |
| SEC-DATA-06 | Notify and delete accounts inactive 24 months | Not at all | No accounts exist. |
| SEC-DATA-07 | Publish subprocessor list; offer a DPA | Not at all | Neither has been written. |
| SEC-DATA-08 | Single US hosting region; documented EU transfer safeguards | Not at all | No region is configured or documented. |
| SEC-DATA-09 | No training on customer content | Fully | The app trains nothing; provider terms are covered under SEC-LLM-08. |
| SEC-PAY-01 | Never receive, process or store card data | Fully | There are no payment features, so no card data is ever collected. |
| SEC-PAY-02 | Reject bad or stale Stripe webhook signatures | Not at all | There is no Stripe integration. |
| SEC-PAY-03 | Idempotent webhook handling | Not at all | There is no Stripe integration. |
| SEC-PAY-04 | Entitlements only from verified webhook state | Not at all | There are no entitlements or Stripe integration. |
| SEC-PAY-05 | Plan selection from an allowlist of Price IDs | Not at all | There are no plans. |
| SEC-PAY-06 | Reserve allowance atomically before the AI call; release on failure | Not at all | There is no paid allowance (usage counters are taken before the AI call but are never released on failure). |
| SEC-WEB-01 | Strict nonce-based Content-Security-Policy | Fully | The production CSP has every listed directive with a fresh nonce per page (tested and checked live); the local dev server relaxes it. |
| SEC-WEB-02 | nosniff, Referrer-Policy, Permissions-Policy | Fully | All three are sent on every response (tested and checked live). |
| SEC-WEB-03 | Encode all user-supplied strings on output | Fully | React escapes every string the page shows; tested with XSS payloads in bullets. |
| SEC-WEB-04 | Per-account rate limits; 10 generations/hour; 429 + Retry-After | Partly | Limits are per visitor IP (no accounts): 10 analyses and 30 uploads per hour, with 429 and Retry-After (tested), but counts live in memory and reset when Vercel restarts. |
| SEC-WEB-05 | Never fetch user- or document-supplied URLs | Fully | The server makes no outbound requests except to the AI API; external DOCX targets are never fetched (tested). |
| SEC-EXP-01 | Exported DOCX metadata blank | Not at all | There is no export feature. |
| SEC-EXP-02 | Server re-checks placeholders before export | Not at all | There is no export feature. |
| SEC-EXP-03 | Export signed URLs; delete exports in 24 h | Not at all | There is no export feature. |
| SEC-AUD-01 | Append-only audit events for listed actions | Not at all | There is no audit log. |
| SEC-AUD-02 | Audit event fields, no content | Not at all | There is no audit log. |
| SEC-AUD-03 | Keep audit events 1 year | Not at all | There is no audit log. |
| SEC-ABUSE-01 | Alert at 80% of daily AI spend; pause at 100% | Partly | A daily cap on the number of analyses (default 200) pauses analysis at the limit, but there is no spend tracking, no 80% alert, and the count resets with the server. |
| SEC-ABUSE-02 | Trial tied to verified, non-disposable email; sign-up rate limit | Not at all | There is no trial or sign-up; anonymous use is limited only per IP. |
| SEC-ABUSE-03 | No ATS-deception features | Fully | No such feature exists, and hidden text in uploads is stripped rather than used. |
| SEC-OPS-01 | Secrets from a secrets manager; CI blocks committed secrets | Partly | The key comes from an environment variable and `.env*` files are git-ignored, but there is no CI or secret scanning. |
| SEC-OPS-02 | Lockfile, CI dependency scanning, 7-day patch SLA | Partly | `package-lock.json` pins dependencies and `npm audit` found 0 vulnerabilities at install, but there is no CI scanning or patch process. |
| SEC-OPS-03 | SPF, DKIM and DMARC on sending domain | Not at all | The app sends no email. |
