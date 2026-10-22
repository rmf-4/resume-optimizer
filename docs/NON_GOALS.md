# Non-Goals: Resume & LinkedIn Optimizer (v1)

**Date:** 2026-09-29 · The items below are **deliberately out of scope for v1**. Proposing one of them means changing this file first. Items marked ⚠️ came from an assumption (see the register in `requirements.md`), not from something you stated.

## Users & access
- **NG-01** Client logins, client portals, or client approval workflows. ⚠️ A-02
- **NG-02** Team or agency accounts, sharing between coaches, roles or seats. ⚠️ A-02
- **NG-03** A product designed around job seekers optimising their own resume. Anyone can sign up, but the UX and consent model assume a coach. ⚠️ A-01
- **NG-04** Enterprise SSO (SAML), SCIM provisioning, and OAuth providers other than Google and LinkedIn. ⚠️ A-03
- **NG-05** Native mobile apps. A responsive web app only.

## Inputs
- **NG-06** OCR, scanned or image-only PDFs, and image files. ⚠️ A-05
- **NG-07** File formats other than PDF and DOCX (DOC, RTF, Pages, ODT, TXT upload, Google Docs import). Pasting the resume is also out. ⚠️ A-04
- **NG-08** **Fetching a job description from a URL**, or scraping job boards or LinkedIn profiles. This is excluded on purpose to remove the SSRF and scraping-ToS risk.
- **NG-09** Languages other than English. ⚠️ A-06

## Output & features
- **NG-10** **Inventing facts.** The product never invents employers, titles, dates, degrees, certifications or metrics. It brackets them for the coach to verify. This is a permanent non-goal, not just a v1 one.
- **NG-11** ATS-gaming techniques: hidden or white text, invisible keyword blocks, keyword stuffing. This is also permanent.
- **NG-12** An "ATS score", a pass-rate prediction, or simulating specific ATS vendors (Workday, Greenhouse and so on). The product makes no claim that output will pass any ATS.
- **NG-13** Preserving the original resume layout or design, resume templates, or PDF export. ⚠️ A-14
- **NG-14** Rewriting sections other than Work Experience (Summary, Skills, Education and so on). ⚠️ A-24
- **NG-15** Cover letters, interview prep, job search or matching, salary advice.
- **NG-16** Posting to LinkedIn or any other integration with the LinkedIn API beyond OAuth sign-in.
- **NG-17** Real-time collaborative editing.
- **NG-18** Detecting or removing protected-characteristic signals (for example age proxies from graduation years). It could be a future feature, but it isn't in v1.

## Data, AI & compliance
- **NG-19** Training or fine-tuning any model on customer content. This is permanent.
- **NG-20** Self-hosted or on-prem LLMs, and multi-provider failover. ⚠️ A-07
- **NG-21** Multi-region hosting or EU data residency. ⚠️ A-22
- **NG-22** SOC 2 or ISO 27001 certification, HIPAA, FedRAMP. The controls are designed to be compatible, but certification isn't in v1.
- **NG-23** Human review of outputs by our staff. ⚠️ A-17

## Payments
- **NG-24** Handling card data directly, custom invoicing, usage-based metered billing, refunds outside Stripe's standard tools, and tax handling beyond what Stripe provides. ⚠️ A-10
- **NG-25** Per-generation credit packs. v1 is a subscription plus a trial only. ⚠️ A-10, A-23
