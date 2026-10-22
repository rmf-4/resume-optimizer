# Requirements: Resume & LinkedIn Optimizer (v1)

**Status:** Draft for review · **Date:** 2026-09-29 · **Companions:** `SECURITY_SPEC.md`, `TEST_SPEC.md`, `NON_GOALS.md`

## Conventions

- Acceptance criteria use **EARS** patterns:
  - *Ubiquitous*: "The system shall …"
  - *Event-driven*: "When ⟨trigger⟩, the system shall …"
  - *State-driven*: "While ⟨state⟩, the system shall …"
  - *Unwanted behaviour*: "If ⟨condition⟩, then the system shall …"
  - *Optional feature*: "Where ⟨feature⟩, the system shall …"
- IDs: `US-*` = user story, `REQ-*` = acceptance criterion. Every `REQ-*` maps to a named test in `TEST_SPEC.md`.
- **⚠️ A-nn** marks a criterion that depends on an assumption. The full register is at the bottom of this file. Every flagged item needs sign-off.
- "Coach" = the signed-in user. "Client" = the person whose resume is being optimised. "Generation" = one full 3-step run (⚠️ A-19).

## Product summary

A web app where a coach uploads a client's resume (PDF/DOCX), provides a target job description and optional notes, and receives a 3-step report: (1) ATS keyword gap analysis, (2) an XYZ-formula rewrite of the Work Experience section with bracketed placeholders for unverified metrics, and (3) a LinkedIn headline and About section. The coach resolves the placeholders, then exports. The product's core promise is **optimisation without fabrication**.

---

## 1. Accounts & authentication (AUTH)

**US-AUTH-1.** As a coach, I want to sign up with email and password so that I can use the tool without a third-party identity.

- **REQ-AUTH-01** When a visitor submits the sign-up form with an email and a password that meets policy (SEC-AUTH-01), the system shall create an unverified account and send a verification email.
- **REQ-AUTH-02** While an account is unverified, the system shall block document upload, client creation and generation, and shall show a "verify your email" prompt.
- **REQ-AUTH-03** When a user opens an unexpired, unused verification link, the system shall mark the account verified.

**US-AUTH-2.** As a coach, I want to sign in with an existing identity provider so that I don't have to manage another password.

- **REQ-AUTH-04** When a visitor completes sign-in with Google or LinkedIn and the provider asserts a verified email, the system shall sign them in, creating a verified account if none exists. ⚠️ A-03

**US-AUTH-3.** As a coach, I want to reset a forgotten password so that I can regain access.

- **REQ-AUTH-05** When a user requests a password reset, the system shall send a single-use reset link to the address on file (if any) and show the same confirmation message whether or not the address exists.

**US-AUTH-4.** As a coach holding many clients' personal data, I want to protect my account with a second factor.

- **REQ-AUTH-06** Where a user has enabled TOTP MFA, the system shall require a valid TOTP code or an unused recovery code at every password sign-in. ⚠️ A-21

**US-AUTH-5.** As a coach, I want to delete my account and everything in it.

- **REQ-AUTH-07** When a user confirms account deletion (re-authentication required), the system shall cancel any active subscription at period end without a refund, delete all clients, documents, generations and exports, and revoke all sessions.
- **REQ-AUTH-08** When an account or client is deleted, the system shall remove the data from primary storage within 24 hours and from backups within 30 days. ⚠️ A-08

---

## 2. Client workspace (CLI)

**US-CLI-1.** As a coach, I want a separate workspace per client so that inputs and outputs never mix.

- **REQ-CLI-01** When a coach creates a client, the system shall require a display name and a checked attestation that "I have this person's permission to process their resume with an AI service". ⚠️ A-02, A-15
- **REQ-CLI-02** The system shall show a coach only the clients, documents and generations that coach created.

**US-CLI-2.** As a coach, I want to delete a client when the engagement ends.

- **REQ-CLI-03** When a coach confirms deletion of a client, the system shall delete that client's documents, generations and exports, subject to REQ-AUTH-08.

**US-CLI-3.** As a coach, I want to hand a client all of their stored data when they ask for it (GDPR/CCPA access request).

- **REQ-CLI-04** When a coach requests a data export for a client, the system shall produce a downloadable ZIP of all stored inputs, extracted text, generations and versions for that client within 24 hours. ⚠️ A-09

---

## 3. Inputs (IN)

**US-IN-1.** As a coach, I want to upload my client's resume as PDF or DOCX.

- **REQ-IN-01** When a coach uploads a resume file, the system shall accept it only if it is a PDF or DOCX of at most 5 MB and at most 10 pages. ⚠️ A-04
- **REQ-IN-02** If an uploaded file is of another type, exceeds a limit, is password-protected, is macro-enabled, or cannot be parsed, then the system shall reject it with a reason specific to that failure and shall not store it.
- **REQ-IN-03** If a PDF yields fewer than 200 extractable text characters, then the system shall reject it with the message "This looks like a scanned image; upload a text-based PDF or DOCX". ⚠️ A-05
- **REQ-IN-04** When a file is accepted, the system shall show the extracted plain text, which the coach can edit and must confirm before generation.
- **REQ-IN-05** If extraction finds hidden text (white or near-background colour, font size under 4 pt, positioned off-page, or a DOCX run marked hidden), then the system shall exclude that text from the extracted text and show a warning quoting what was removed. ⚠️ A-16

**US-IN-2.** As a coach, I want to supply the target job description.

- **REQ-IN-06** The system shall accept the job description as pasted text of at most 20,000 characters, or as a PDF/DOCX file under the REQ-IN-01 and REQ-IN-02 rules. ⚠️ A-04
- **REQ-IN-07** If the job description is under 300 characters after trimming, then the system shall block generation and ask for the full posting. ⚠️ A-04

**US-IN-3.** As a coach, I want to add rough notes and metrics the resume doesn't include.

- **REQ-IN-08** The system shall accept optional additional context as pasted text of at most 10,000 characters.
- **REQ-IN-09** If the resume or the job description is detected as not English, then the system shall warn that non-English input is unsupported and require explicit confirmation before generating. ⚠️ A-06

---

## 4. Generation: report structure & Step 1 (GEN)

**US-GEN-1.** As a coach, I want one click to produce the full 3-step report.

- **REQ-GEN-01** When a coach starts a generation with a confirmed resume text and a valid job description, the system shall produce one report with the Markdown headers "Step 1: ATS & Keyword Gap Analysis", "Step 2: Resume Bullet Point Rewrite" and "Step 3: LinkedIn Profile Optimization", in that order. ⚠️ A-37
- **REQ-GEN-02** While a generation is running for a client, the system shall show progress and reject a second generation request for the same client.

**US-GEN-2.** As a coach, I want to see which job-description keywords the resume is missing.

- **REQ-GEN-03** The system shall list between 8 and 12 keywords, each labelled with exactly one category (hard skill, soft skill, tool, industry term) and one status (missing, underrepresented).
- **REQ-GEN-04** If a listed keyword does not appear in the job description (case-insensitive, after stemming), then the system shall remove it from the list before display. If this leaves fewer than 8 keywords, it shall regenerate per REQ-ERR-02. ⚠️ A-35
- **REQ-GEN-05** The system shall list exactly 3 weak bullets, each quoted verbatim from the resume text and each with a one-sentence reason (generic, no measurable impact, or passive phrasing).
- **REQ-GEN-06** If the resume contains fewer than 3 bullets, then the system shall list all of them and state how many are missing. ⚠️ A-25

## 5. Generation: Step 2 rewrite (GEN)

**US-GEN-3.** As a coach, I want the work experience rewritten in XYZ form with the missing keywords worked in.

- **REQ-GEN-07** The system shall rewrite every role in the Work Experience section, keeping each employer name, job title and date range character-for-character identical to the extracted text, and shall not output any other resume section. ⚠️ A-24
- **REQ-GEN-08** The system shall begin every rewritten bullet with a past-tense action verb, and no bullet shall begin with "Responsible for", "Helped", "Assisted", "Worked on" or "Participated in".
- **REQ-GEN-09** The system shall structure each rewritten bullet as accomplishment (X), measure (Y) and method (Z).
- **REQ-GEN-10** When a Step 1 keyword is supported by evidence in the resume or additional context, the system shall use it in at least one rewritten bullet.
- **REQ-GEN-11** If a Step 1 keyword has no supporting evidence in any input, then the system shall not insert it into a bullet and shall list it under "Gaps to discuss with client". ⚠️ A-36
- **REQ-GEN-12** The system shall use any single keyword at most 2 times across the Step 2 output. ⚠️ A-30

## 6. Fidelity & placeholders (PH)

**US-PH-1.** As a coach, I want every number or fact I haven't verified to be obvious, so that I never send my client a fabricated resume.

- **REQ-PH-01** The system shall wrap in square brackets every number, percentage, currency amount, headcount or duration in Steps 2 and 3 that does not appear in the inputs (for example "[X]%" or "[$Y]"). ⚠️ A-12
- **REQ-PH-02** When model output is received, the system shall run a deterministic check comparing every numeric token in the output with the numeric tokens in the inputs. If any unbracketed number is not found in the inputs, then the system shall bracket it and mark it as a placeholder.
- **REQ-PH-03** If the output contains an employer, job title, school, degree, certification, date, URL, email address or phone number that is not in the inputs, then the system shall mark it "Unverified" and count it as an unresolved placeholder. ⚠️ A-13
- **REQ-PH-04** The system shall display the count of unresolved placeholders and a list that jumps to each one.

## 7. LinkedIn (LI)

**US-LI-1.** As a coach, I want a recruiter-searchable headline and About section for my client.

- **REQ-LI-01** The system shall produce a LinkedIn headline of at most 220 characters in the form "Target Title | Core Skill / Specialization | Value Proposition". ⚠️ A-11
- **REQ-LI-02** If a generated headline exceeds 220 characters, then the system shall request one regeneration. If it is still too long, the system shall show it with a character-count error and treat it as an unresolved placeholder, and shall never truncate it silently.
- **REQ-LI-03** The system shall produce an About section of exactly 3 paragraphs in the first person, ending with a call to action in the final paragraph.
- **REQ-LI-04** The system shall keep the About section at or under 2,600 characters. ⚠️ A-18

---

## 8. Review, editing & export (OUT)

**US-OUT-1.** As a coach, I want to edit the report and fill in the real numbers.

- **REQ-OUT-01** The system shall render the report as sanitised Markdown with the three step headers and the "Gaps to discuss with client" and "Unverified items" sub-sections. ⚠️ A-37
- **REQ-OUT-02** When a coach edits any output text and saves, the system shall store a new version and keep every prior version viewable.
- **REQ-OUT-03** When a coach replaces a placeholder's brackets with a value, or explicitly confirms an "Unverified" item, the system shall mark it resolved.

**US-OUT-2.** As a coach, I want export to be impossible until everything is verified.

- **REQ-OUT-04** While any placeholder or Unverified item is unresolved, the system shall disable every export and copy action and show the list of unresolved items.
- **REQ-OUT-05** When every placeholder is resolved, the system shall allow export as DOCX and a copy-to-clipboard of the Markdown. ⚠️ A-14
- **REQ-OUT-06** The system shall show, next to the export controls, a notice that the coach is responsible for the factual accuracy of the exported content.

**US-OUT-3.** As a coach, I want to revisit earlier runs.

- **REQ-OUT-07** The system shall list each client's past generations with creation time, the job description's first line, and resolution status.

---

## 9. Billing (BILL)

**US-BILL-1.** As a coach, I want to try the product and then subscribe.

- **REQ-BILL-01** When an account is first verified, the system shall grant 3 free generations with no payment method required. ⚠️ A-23
- **REQ-BILL-02** When a coach selects a plan, the system shall redirect to Stripe Checkout, and shall activate the subscription only on receipt of a verified Stripe webhook confirming payment. ⚠️ A-10
- **REQ-BILL-03** While a subscription is active, the system shall allow generations up to the plan's monthly cap and shall reset the counter at each billing-cycle renewal. ⚠️ A-10, A-19
- **REQ-BILL-04** If a coach has no free or plan generations left, then the system shall block new generations and show upgrade options, while still allowing viewing, editing and export of existing work.
- **REQ-BILL-05** If a generation fails or is discarded under REQ-ERR-01 or REQ-ERR-02, then the system shall not count it against any allowance. ⚠️ A-20

**US-BILL-2.** As a coach, I want to manage billing myself.

- **REQ-BILL-06** When a coach opens "Manage billing", the system shall redirect them to the Stripe Customer Portal for their customer record.
- **REQ-BILL-07** When Stripe reports a failed renewal payment, the system shall email the coach and keep full access for 7 days. If payment is still outstanding after that, the system shall switch the account to read-only (no new generations). ⚠️ A-29
- **REQ-BILL-08** When a coach cancels, the system shall keep access until the end of the paid period and shall retain their data unless they delete the account.

---

## 10. Errors (ERR)

**US-ERR-1.** As a coach, I want failures to be clear and never to cost me a generation.

- **REQ-ERR-01** If the LLM call errors or exceeds 120 seconds, then the system shall retry once with backoff. If the retry also fails, the system shall show an error message and store nothing as a completed generation. ⚠️ A-34
- **REQ-ERR-02** If the model output fails structural validation (a missing step, a count outside the REQ-GEN-03, REQ-GEN-05 or REQ-LI-03 bounds, or unparseable output), then the system shall re-request once. If the output is still invalid, the system shall show an error and discard the output.
- **REQ-ERR-03** If the model declines the request, then the system shall show the model's stated reason in plain text and treat the run as failed under REQ-BILL-05.

---

## Assumption register

Each of these was **decided by me, not by you**. "Default Qn" means you accepted my default to that question. "Inferred" means I filled a gap you didn't cover.

| ID | Assumption | Source | Impact if wrong |
|---|---|---|---|
| **A-01** | Primary user is a **solo career coach** managing many clients. **You didn't answer Q1.** | Default Q1 (unconfirmed) | If job seekers are primary, the client/consent model, pricing and UX all change. |
| A-02 | Clients never log in. The coach is the only actor. | Default Q5 | A client portal needs sharing, invitations and new authorization rules. |
| A-03 | OAuth providers are **Google and LinkedIn** (OIDC). | Inferred | A different provider set means different ID-token validation. |
| A-04 | Resume is **upload only** (no paste). JD can be pasted or uploaded. Limits: 5 MB, 10 pages, JD 300–20,000 chars, notes ≤10,000 chars. | Inferred | Limits are placeholders to tune. |
| A-05 | No OCR for scanned PDFs. | Inferred | OCR adds a service and a new attack surface. |
| A-06 | English only. | Inferred | — |
| A-07 | A single LLM provider (e.g. the Anthropic API) under zero-data-retention and no-training terms, with no fallback provider. | Default Q4 | A second provider doubles the vendor review. |
| A-08 | Data is kept for the account's lifetime. Purge SLA: 24 h from primary storage, 30 days from backups. | Default Q3 | — |
| A-09 | GDPR and CCPA are in scope. **The coach is the data controller and we are the processor** for client data, so a DPA is offered. | Default Q4 | **Needs legal review.** |
| A-10 | Stripe Checkout plus Customer Portal. Subscription with a monthly generation cap. **Prices and caps are TBD.** | Default Q6 | — |
| A-11 | "220-character headline" means **at most** 220 (LinkedIn's limit), not exactly 220. | Inferred | — |
| A-12 | Placeholders use `[square brackets]`. | Prompt | — |
| A-13 | Unverified-entity classes: employer, title, school, degree, certification, date, URL, email, phone, numbers. | Default Q7 | — |
| A-14 | Export is DOCX plus Markdown copy. **No PDF export, and the original resume layout is not preserved.** | Inferred | Layout preservation is a large feature. |
| A-15 | A consent-attestation checkbox is enough evidence of the client's permission. | Inferred | **Needs legal review.** |
| A-16 | Hidden-text heuristics are: colour ≈ background, size < 4 pt, off-page, DOCX hidden runs. | Default Q8 | False positives or negatives are possible. |
| A-17 | Staff cannot view content except through a logged break-glass procedure. We do no human review of outputs. | Inferred | — |
| A-18 | The LinkedIn About limit is 2,600 characters. **Verify against LinkedIn's current limit.** | Inferred | — |
| A-19 | One generation is one full 3-step run. "Regenerate" counts as a new generation. Edits are free. | Inferred | — |
| A-20 | Failed or invalid runs don't consume an allowance. | Inferred | Cost exposure. |
| A-21 | TOTP MFA is **optional**, not mandatory. | Inferred | Given the PII, you may want it mandatory. |
| A-22 | Hosting in a single US region. EU transfers under Standard Contractual Clauses (SCCs). | Inferred | — |
| A-23 | Free trial of 3 generations, no card required. | Inferred | This is an abuse vector (see SEC-ABUSE). |
| A-24 | Step 2 rewrites **only** Work Experience. Other sections are not output. | Prompt ("Rewrite the Work Experience section") | — |
| A-25 | If the resume has fewer than 3 bullets, list them all and state the shortfall. | Inferred | — |
| A-26 | Session timeouts: 30 min idle, 12 h absolute. | Inferred | — |
| A-27 | Audit logs are kept for 1 year. | Inferred | — |
| A-28 | Password policy follows NIST 800-63B (≥12 characters, breached-password check, no composition rules). | Inferred | — |
| A-29 | Failed payment: 7-day grace period, then read-only. | Inferred | — |
| A-30 | Keyword-stuffing cap: 2 uses per keyword in Step 2. | Default Q8 | — |
| A-31 | Cost and rate limits: 10 generations per hour per account, 30k input tokens, 8k output tokens, and a global daily spend circuit breaker. | Inferred | — |
| A-32 | Accounts inactive for 24 months are deleted after a 30-day notice. | Inferred | — |
| A-33 | LLM evaluation thresholds are the ones in TEST_SPEC §0. | Inferred | — |
| A-34 | Generation timeout 120 s, with 1 retry. | Inferred | — |
| A-35 | Step 1 keywords must be **grounded in the JD text**. General industry terms the JD doesn't contain are dropped. | Inferred | Narrower than the prompt's "industry keywords". |
| A-36 | **A deliberate deviation from the prompt.** The prompt says to integrate the missing keywords "seamlessly". I only integrate keywords that the inputs give evidence for. The rest go to "Gaps to discuss with client". | Default Q7 ("preserve factual accuracy") | Without this, the product fabricates skills. |
| A-37 | The report adds two sub-sections beyond the prompt's format: "Gaps to discuss with client" and "Unverified items". | Follows from A-36 and Q7 | — |
| A-38 – A-41 | Security thresholds (lockout, sandbox limits, disposable-email blocklist, CVE patch SLA). | Inferred | See the end of `SECURITY_SPEC.md`. |

---

## Scope for HW3

- Build story US-IN-2: supply the target job description (REQ-IN-06 in full: pasted text **or** a PDF/DOCX file under the REQ-IN-01 and REQ-IN-02 rules, plus REQ-IN-07 for file text).
- No real payments. Where the spec says to charge a card, use a
  "Simulated payment" button and list real payments as a non-goal in
  the README.
- No sign-in provider. Where the spec needs a signed-in user, use a
  name typed into a text box and list real authentication as a
  non-goal.
- No database. Keep data in memory on the server and say in the README
  that it resets on every deploy.

Decisions agreed before the build (2026-10-22):

- **REQ-IN-06a** If the text extracted from a job-description file is longer than 20,000 characters after trimming, then the system shall reject the file with a reason and shall not truncate it.
- **REQ-IN-07a** If the text extracted from a job-description file is under 300 characters after trimming, then the system shall reject the file at upload with the REQ-IN-07 message.
- **REQ-IN-05a** When a job-description file is uploaded, the system shall exclude hidden text and warn, quoting it, using the same rules as REQ-IN-05 for resumes.
