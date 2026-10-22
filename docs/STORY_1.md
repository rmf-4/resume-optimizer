# Story 1: Resume keyword gap analysis (first slice)

**Date:** 2026-10-01 · **Status:** In build · Companion to `requirements.md`, `SECURITY_SPEC.md`, `TEST_SPEC.md`, `NON_GOALS.md`.

## Scope change (agreed 2026-10-01)

The first slice has **no coach and no accounts**. Any visitor can upload a resume, paste a job description and get **Step 1: ATS & Keyword Gap Analysis**. This deliberately departs from the main spec for now:

| Main spec | This slice |
|---|---|
| A-01, A-02, NG-03: the user is a coach managing clients | Anonymous visitor, no clients, no sign-in |
| US-AUTH-*, US-CLI-*, US-BILL-* | Not built. No payments. |
| Data stored per client | **Nothing is stored.** Files and text live only for the length of one request. |
| Steps 1–3 | Step 1 only |

The coach model is expected to return in a later slice. Until then, `NON_GOALS.md` NG-03 is suspended for this slice only.

## User story

**US-S1-1.** As a visitor, I want to upload my resume, paste a target job description and see which of the job's keywords my resume is missing and which of my bullets are weakest, so that I know what to fix.

## Acceptance criteria

IDs from `requirements.md` / `SECURITY_SPEC.md` are reused where the criterion is unchanged or only narrowed. New criteria use `REQ-S1-*`.

### Inputs
- **REQ-IN-01** Accept a resume only if it is a PDF or DOCX of at most 5 MB and at most 10 pages.
- **REQ-IN-02** Reject other types, over-limit, password-protected, macro-enabled and unparseable files with a reason specific to that failure. Nothing is stored.
- **REQ-IN-03** Reject a PDF with fewer than 200 extractable characters with "This looks like a scanned image; upload a text-based PDF or DOCX".
- **REQ-IN-04** Show the extracted text. The visitor can edit it and must confirm it before analysis (enforced in the page and on the server).
- **REQ-IN-05** *(partial)* Exclude hidden text and warn, quoting it. Covered today: DOCX hidden runs, white text and text under 4 pt; PDF text under 4 pt. PDF text positioned off-page is excluded (the PDF library drops it), but it can't be quoted in the warning. **Not yet:** PDF text coloured like the background.
- **REQ-IN-06** *(narrowed)* Accept the job description as pasted text of at most 20,000 characters. JD file upload is deferred.
- **REQ-IN-07** Block analysis if the job description is under 300 characters after trimming.
- **REQ-S1-01** Block analysis if the confirmed resume text is over 50,000 characters (keeps input under the SEC-LLM-09 token cap).

### Step 1 output
- **REQ-GEN-01** *(narrowed)* The report carries the header "Step 1: ATS & Keyword Gap Analysis".
- **REQ-GEN-03** 8–12 keywords, each with exactly one category (hard skill, soft skill, tool, industry term) and one status (missing, underrepresented).
- **REQ-GEN-04** Drop any keyword not found in the job description (case-insensitive, after stemming). If fewer than 8 remain, re-request once (REQ-ERR-02).
- **REQ-S1-02** The status is set by code, not by the model: "missing" if the keyword (stemmed) is not in the resume, otherwise "underrepresented".
- **REQ-GEN-05** Exactly 3 weak bullets, each quoted verbatim from the resume, each with a reason (generic, no measurable impact, passive phrasing) and one sentence of explanation.
- **REQ-GEN-06** If the resume has fewer than 3 bullets, list all of them and state how many are missing.

### Errors
- **REQ-ERR-01** If the AI call errors or exceeds 120 s, retry once. If the retry fails, show an error.
- **REQ-ERR-02** If the output fails validation, re-request once. If still invalid, show an error and discard it.
- **REQ-ERR-03** If the model declines, show its stated reason in plain text.

### Security (this slice)
- **SEC-FILE-01** File type from magic bytes and container structure, not the name or `Content-Type`.
- **SEC-FILE-03** DOCX XML with a DTD is rejected (no entity processing at all).
- **SEC-FILE-04** DOCX zip-bomb limits: 50 MB expanded, 1,000 entries, 100:1 ratio.
- **SEC-FILE-05** DOCX with macros or external relationships is rejected; targets are never fetched.
- **SEC-FILE-06** PDF: text only; scripts, attachments and actions ignored.
- **SEC-FILE-09** Only the confirmed, hidden-text-stripped text is sent to the AI.
- **SEC-LLM-01** Resume and JD are sent in separately delimited data blocks, with delimiter look-alikes in the input neutralised.
- **SEC-LLM-02** No tools; only this request's inputs.
- **SEC-LLM-03** Output is validated before display.
- **SEC-LLM-04** *(adapted)* Output is rendered as plain text by React. No Markdown, HTML, images or links are rendered.
- **SEC-LLM-07** The API key lives only in a server environment variable.
- **SEC-LLM-09** Output capped; oversized input rejected before the call (REQ-S1-01, REQ-IN-06).
- **SEC-WEB-01 / SEC-WEB-02** Security headers and a nonce-based Content-Security-Policy.
- **SEC-WEB-04** *(adapted)* 10 analyses per hour per visitor IP; 429 with `Retry-After`.
- **SEC-ABUSE-01** *(adapted)* A daily cap on total analyses (default 200). At the cap, analysis pauses with a service notice.
- **SEC-SESS-04** *(adapted)* POST requests with a mismatched `Origin` are rejected with 403.
- **SEC-DATA-03** Resume and JD text never appear in server logs.

### Demo mode
- **REQ-S1-03** If no `ANTHROPIC_API_KEY` is configured, the app uses a built-in non-AI analyzer and labels every report "Demo mode — simulated analysis". The same guards apply.

## Known limits of this slice
- Rate-limit and daily-cap counters are held in server memory. On Vercel they reset when an instance restarts and are not shared between instances, so they are best-effort only.
- No upload sandbox (SEC-FILE-02) or malware scan (SEC-FILE-07). Files are parsed in memory and never stored or served back.
- English only, no language check (REQ-IN-09). No additional-notes field (REQ-IN-08).
