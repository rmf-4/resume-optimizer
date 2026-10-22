# Security Specification: Resume & LinkedIn Optimizer (v1)

**Status:** Draft · **Date:** 2026-09-29 · Uses the EARS conventions and the ⚠️ A-nn assumption flags from `requirements.md`. New assumptions introduced here are numbered A-38 onwards and listed at the end.

## 0. Threat model summary

| Asset | Why it matters |
|---|---|
| Client resume data (name, contact details, employment history; often age proxies, visa status, address) | This is bulk PII held on behalf of third parties (clients) who never signed up. A breach harms people who aren't our users. |
| Coach credentials and sessions | One account holds many clients' PII. |
| Subscription and entitlement state | Free-riding and quota bypass. |
| LLM API key and spend | Direct cost exposure and denial-of-wallet. |
| Integrity of outputs | A fabricated credential on a resume is a real-world harm to the client and to employers, and a liability for us. |

| Threat actor | Primary vectors |
|---|---|
| External attacker | Credential stuffing, account takeover (ATO), web vulnerabilities, malicious uploads |
| **Malicious or curious coach (authenticated tenant)** | Access to other tenants' objects (IDOR), quota abuse, using the tool for resume fraud |
| **Malicious document author.** A JD or resume can be written by anyone: a job board, a scam posting, a third party. | Prompt injection, parser exploits (XXE, zip bomb, PDF JavaScript), hidden-text ATS gaming, exfiltration through rendered output |
| Compromised or misbehaving vendor (LLM, Stripe, email) | Data retention, forged webhooks |

Design principle: **the LLM is an untrusted text transformer.** It gets no tools, no network access and no data beyond the current run's inputs, and everything it outputs is validated and sanitised before it is shown.

---

## 1. Authentication (SEC-AUTH)

- **SEC-AUTH-01** The system shall require passwords of 12–128 characters, reject passwords found in a breached-password corpus (k-anonymity lookup), and impose no composition rules. ⚠️ A-28
- **SEC-AUTH-02** The system shall store passwords only as Argon2id hashes (memory ≥ 19 MiB, iterations ≥ 2), or as bcrypt with cost ≥ 12 if Argon2id is unavailable.
- **SEC-AUTH-03** If an account has 5 failed sign-in attempts within 15 minutes, then the system shall apply exponential back-off to that account. If one IP produces 20 failures across accounts within 15 minutes, then the system shall throttle that IP. ⚠️ A-38
- **SEC-AUTH-04** The system shall return responses from sign-up, sign-in and password reset that do not reveal whether an email is registered, with identical bodies and status codes and response times that differ by no more than 100 ms at the median.
- **SEC-AUTH-05** The system shall generate verification and reset tokens with ≥ 128 bits of CSPRNG entropy and store only their hashes. Tokens are single-use. Reset tokens expire after 30 minutes and verification tokens after 24 hours.
- **SEC-AUTH-06** When a password is changed or reset, or MFA is enabled or disabled, the system shall revoke all of the user's other sessions and email the user a notification.
- **SEC-AUTH-07** The system shall perform OAuth sign-in with the authorization-code flow using PKCE (S256), a per-request `state`, and an OIDC `nonce`. It shall validate the ID token's signature, `iss`, `aud`, `exp` and `nonce`. ⚠️ A-03
- **SEC-AUTH-08** If an OAuth identity's email matches an existing account that isn't linked to that provider, then the system shall link the identity only after the user proves control of the existing account by signing in to it. If the provider does not assert `email_verified=true`, the system shall reject the sign-in.
- **SEC-AUTH-09** Where MFA is enabled, the system shall store TOTP secrets encrypted at rest, issue 10 single-use recovery codes stored as hashes, and reject a TOTP code that has already been used in its time step. ⚠️ A-21
- **SEC-AUTH-10** When a user performs a sensitive action (account deletion, email change, MFA change, client data export), the system shall require re-authentication within the preceding 5 minutes.

## 2. Sessions & request integrity (SEC-SESS)

- **SEC-SESS-01** The system shall issue session cookies with `HttpOnly`, `Secure`, `SameSite=Lax` and the `__Host-` prefix, holding an opaque ID of ≥ 128 bits.
- **SEC-SESS-02** The system shall expire a session after 30 minutes of inactivity or 12 hours from sign-in, whichever comes first. ⚠️ A-26
- **SEC-SESS-03** When a user signs in or completes MFA, the system shall issue a new session ID and invalidate the old one (preventing session fixation).
- **SEC-SESS-04** If a state-changing request lacks a valid CSRF token or has a mismatched `Origin` header, then the system shall reject it with 403.
- **SEC-SESS-05** When a user signs out, the system shall invalidate the session server-side.

## 3. Authorization & tenant isolation (SEC-AZ)

- **SEC-AZ-01** The system shall authorise every read and write of a client, document, generation, version or export by checking server-side that it is owned by the requesting coach.
- **SEC-AZ-02** If a coach requests an object owned by another coach, then the system shall respond 404 (the same response as for a non-existent object) and write an audit event.
- **SEC-AZ-03** The system shall enforce tenant scoping at the data layer (row-level security or a mandatory tenant predicate), so that a query without a tenant context returns no rows.
- **SEC-AZ-04** The system shall use random UUIDv4 object identifiers. Authorisation shall not rely on them being unguessable.
- **SEC-AZ-05** The system shall give staff no standing access to client content. Where break-glass access is used, it shall require a second approver, be limited to 1 hour, and be written to the audit log. ⚠️ A-17
- **SEC-AZ-06** While an account is unverified or read-only (REQ-BILL-07), the system shall enforce the corresponding restrictions server-side, not only in the UI.

## 4. File upload & parsing (SEC-FILE)

- **SEC-FILE-01** The system shall determine file type from magic bytes and container structure. It shall ignore the extension and the client-supplied `Content-Type` when making that decision.
- **SEC-FILE-02** The system shall parse uploads in an isolated sandbox with no network access, a read-only filesystem, a 30-second CPU limit and a 512 MB memory limit. If a limit is hit, then the system shall abort the parse and reject the file. ⚠️ A-39
- **SEC-FILE-03** The system shall parse DOCX XML with DTDs and external entities disabled.
- **SEC-FILE-04** If a DOCX expands beyond 50 MB, contains more than 1,000 ZIP entries, or has an entry with a compression ratio over 100:1, then the system shall reject it (zip-bomb protection).
- **SEC-FILE-05** If a DOCX contains a VBA project, a macro-enabled content type, or external relationships (remote templates, linked images, OLE objects), then the system shall reject it and shall never fetch the external targets.
- **SEC-FILE-06** The system shall ignore PDF JavaScript, embedded files, launch/URI actions and XFA forms during extraction. Only text is extracted.
- **SEC-FILE-07** When a file passes validation, the system shall scan it for malware before storing it. If malware is detected, then the system shall reject the file and write an audit event.
- **SEC-FILE-08** The system shall store originals in a private bucket under random keys, never use user-supplied filenames in storage paths, and serve downloads only through signed URLs valid for 5 minutes with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- **SEC-FILE-09** The system shall send only the extracted, hidden-text-stripped, coach-confirmed plain text to the LLM, never the original file bytes. (See REQ-IN-05.)

## 5. LLM boundary & prompt injection (SEC-LLM)

- **SEC-LLM-01** The system shall place the resume, JD and additional context in separately delimited data blocks, with instructions telling the model to treat their contents as data. (This reduces risk but is not relied on as a control.)
- **SEC-LLM-02** The system shall call the LLM with no tools, no browsing or retrieval, and a context containing only the current generation's inputs. It shall never include another client's or tenant's data, secrets or internal identifiers.
- **SEC-LLM-03** When model output is received, the system shall validate it against the expected report schema before storing or displaying it (see REQ-ERR-02).
- **SEC-LLM-04** The system shall render model output with a Markdown renderer that has raw HTML disabled, and pass the result through an allowlist HTML sanitiser. It shall not render images, and links shall get `rel="noopener noreferrer nofollow"`. This blocks exfiltration through auto-loaded URLs.
- **SEC-LLM-05** If model output contains a URL, email address or phone number that isn't in the inputs, then the system shall render it as inert text marked "Unverified" (see REQ-PH-03).
- **SEC-LLM-06** If the inputs contain known injection patterns (e.g. "ignore previous instructions", role-play directives, or text addressed to an AI), then the system shall warn the coach and quote the matched text, without blocking the run.
- **SEC-LLM-07** The system shall keep the LLM API key only in the server-side secrets manager, with a separate key per environment. It shall never send the key to the browser.
- **SEC-LLM-08** The system shall use the LLM provider only under contractual zero-data-retention and no-training terms. ⚠️ A-07
- **SEC-LLM-09** The system shall reject inputs over 30k tokens before calling the model and cap output at 8k tokens. ⚠️ A-31
- **SEC-LLM-10** If model output contains instructions for invisible or white-font text, or keyword-stuffing blocks, then the system shall strip them and count the run as invalid (REQ-ERR-02). (Supports REQ-GEN-12.)

## 6. Data protection & privacy (SEC-DATA)

- **SEC-DATA-01** The system shall serve all traffic over TLS 1.2 or later, with HSTS (`max-age` ≥ 1 year, `includeSubDomains`), and shall redirect HTTP to HTTPS.
- **SEC-DATA-02** The system shall encrypt the database, object storage and backups at rest with AES-256, using KMS-managed keys.
- **SEC-DATA-03** The system shall keep resume, JD, context and output text, file contents, passwords, tokens, TOTP secrets and cookies out of application logs, traces and error reports. Logs shall reference objects by ID only.
- **SEC-DATA-04** The system shall not log LLM request or response bodies anywhere other than the stored generation record.
- **SEC-DATA-05** When a deletion completes (REQ-AUTH-08, REQ-CLI-03), the system shall also delete derived artefacts (extracted text, versions, exports, cached renders) and record a deletion receipt with no content in it.
- **SEC-DATA-06** If an account has been inactive for 24 months, then the system shall email a 30-day notice and delete the account if it stays inactive. ⚠️ A-32
- **SEC-DATA-07** The system shall publish a subprocessor list and offer coaches a Data Processing Agreement. ⚠️ A-09
- **SEC-DATA-08** The system shall host data in a single US region and document EU transfer safeguards. ⚠️ A-22
- **SEC-DATA-09** The system shall not train or fine-tune any model on customer content.

## 7. Payments (SEC-PAY)

- **SEC-PAY-01** The system shall never receive, process or store card data. Only Stripe-hosted Checkout and the Customer Portal collect it (keeping us in PCI SAQ-A scope). ⚠️ A-10
- **SEC-PAY-02** If a Stripe webhook's signature is invalid or its timestamp is more than 5 minutes old, then the system shall respond 400 and change no state.
- **SEC-PAY-03** When a webhook event ID has already been processed, the system shall acknowledge it without applying it again (idempotency).
- **SEC-PAY-04** The system shall derive entitlements only from server-side subscription state set by verified webhooks, never from redirect query parameters or client-supplied values.
- **SEC-PAY-05** The system shall accept plan selection only as an identifier from a server-side allowlist of Stripe Price IDs.
- **SEC-PAY-06** The system shall reserve a generation from the allowance atomically before calling the LLM, and release it if the run fails (REQ-BILL-05), so concurrent requests cannot exceed the cap.

## 8. Web application hardening (SEC-WEB)

- **SEC-WEB-01** The system shall send a Content-Security-Policy with `default-src 'self'`, nonce-based `script-src` (no `unsafe-inline` or `unsafe-eval`), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, and `img-src 'self'`.
- **SEC-WEB-02** The system shall send `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that disables camera, microphone and geolocation.
- **SEC-WEB-03** The system shall context-encode all user-derived strings (client names, filenames, JD text, extracted text) on output.
- **SEC-WEB-04** The system shall rate-limit the upload, generation and export endpoints per account. Generation is limited to 10 per hour (⚠️ A-31), and excess requests get 429 with `Retry-After`.
- **SEC-WEB-05** The system shall not fetch any URL supplied by a user or found in a document (no JD-from-URL feature, so no SSRF surface). See NON_GOALS.

## 9. Exports (SEC-EXP)

- **SEC-EXP-01** The system shall generate exported DOCX files with the author, last-modified-by, company, template and custom properties blank, and with no comments, tracked changes or internal IDs.
- **SEC-EXP-02** The system shall re-check on the server, when an export is requested, that no placeholders are unresolved (REQ-OUT-04). The UI state is not trusted.
- **SEC-EXP-03** The system shall deliver exports only through signed URLs valid for 5 minutes and delete the export files within 24 hours.

## 10. Audit logging (SEC-AUD)

- **SEC-AUD-01** The system shall write append-only audit events for: sign-in success and failure, MFA changes, password changes and resets, OAuth linking, email changes, client and account deletion, data exports, document exports, cross-tenant denials (SEC-AZ-02), malware detections, and break-glass access.
- **SEC-AUD-02** The system shall record in each audit event the actor ID, action, object ID, timestamp, IP address and user agent, and no document content.
- **SEC-AUD-03** The system shall keep audit events for 1 year. ⚠️ A-27

## 11. Abuse & cost (SEC-ABUSE)

- **SEC-ABUSE-01** When the global daily LLM spend reaches 80% of the configured budget, the system shall alert operators. At 100%, it shall pause new generations and show a service notice. ⚠️ A-31
- **SEC-ABUSE-02** The system shall tie the free-trial allowance (REQ-BILL-01) to a verified email. It shall not grant a trial to disposable-email domains on a blocklist, and it shall rate-limit sign-ups per IP to 5 per hour. ⚠️ A-23, A-40
- **SEC-ABUSE-03** The system shall not provide any feature whose purpose is hidden text, invisible keywords or other ATS-deception techniques (see REQ-GEN-12, SEC-LLM-10).

## 12. Secrets & supply chain (SEC-OPS)

- **SEC-OPS-01** The system shall load all secrets (LLM key, Stripe secret and webhook secret, OAuth client secrets, DB credentials) from a secrets manager. CI shall fail a build that contains committed secrets.
- **SEC-OPS-02** The system shall pin dependencies with a lockfile, scan them in CI, and patch critical CVEs in parsing, authentication or crypto libraries within 7 days. ⚠️ A-41
- **SEC-OPS-03** The system shall send transactional email from a domain with SPF, DKIM and DMARC (`p=quarantine` or stricter).

---

## Assumptions introduced in this file

| ID | Assumption | Impact if wrong |
|---|---|---|
| A-38 | Lockout thresholds: 5 attempts per account per 15 min, 20 per IP per 15 min. | Tuning only. |
| A-39 | Sandbox limits: 30 s CPU, 512 MB memory. | Large, legitimate files could be rejected. |
| A-40 | A disposable-email blocklist is an acceptable anti-abuse control for the trial. | Some false positives are possible. |
| A-41 | CVE patch SLA of 7 days for critical CVEs. | — |
