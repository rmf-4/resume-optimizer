# Labelling the locked cases

Two teammates label every case in `cases/locked/` on their own. These labels are the expected answers for C1 to C9 in `docs/AGENT_SPEC.md` §5, so they have to be fixed and committed **before the first locked run** (baseline run: November 18).

Read first:

- `docs/AGENT_SPEC.md` §1 (the decision, and which errors matter most)
- `docs/AGENT_SPEC.md` §3, REQ-AG-06 to REQ-AG-11 (must-have vs nice-to-have, person-only, coverage, the 0.70 / 0.40 cutoffs, the fewer-than-3 rule, the missing-credential rule)
- `docs/AGENT_SPEC.md` §4, SEC-AG-03 and SEC-AG-04 (injection, invisible text and scam warnings)
- `docs/AGENT_SPEC.md` §5 (criteria, test set table, rules)

## Rules

1. **Work alone.** Don't discuss cases, share files or look at the other labeller's CSV until both of you have finished.
2. **Don't run the agent on locked cases** before labelling, and don't look at any agent output for them. Use `cases/dev/` while building.
3. **Judge from the texts.** For each case, read `posting.txt`, the resume named in `case.json`, and `notes.txt` if there is one. The folder name, `category` and `designer_intent` say what the case was built to test. They are not the answer. A case built as "borderline" can be a clear apply or skip in your judgment, and a "strong match" can turn out weaker than intended. Label what you see.
4. **Person-only items don't count toward coverage.** Work authorization, sponsorship, salary, relocation or location, background checks, willingness to travel and similar items are person-only (REQ-AG-06). Some items could go either way (a driver's licence, a GPA). If you're unsure whether an item is person-only or a credential, say how you treated it in `notes`.
5. **Trap cases** (`injection`, `hidden_text`, `scam`, plus `modified: true` in `case.json`): `modification` says exactly what was inserted. Label the decision you expect from the spec, and say what the agent must not do.

## The easy way: workbooks

`labels/workbooks/` has one Excel workbook per labeller (`Labelling-Workbook-Labeller-A.xlsx` and `-B.xlsx`). They open in Excel, Google Sheets or Numbers, so nobody needs GitHub. Each case has its own tab with the posting, the resume, any coach notes, what the team changed in trap cases, and the form's questions for full-form cases. Answers go in the four yellow boxes at the top of each tab; the Answers tab collects them. The workbooks show short IDs (L01 to L23) and leave out each case's category and design intent, so labellers judge from the texts alone.

When a workbook comes back, turn it into the CSV with:

```bash
python eval/labels/workbooks/to_csv.py path/to/filled-workbook.xlsx A
```

It writes `labels/labeller-A.csv` with the full case IDs and lists any case without a valid decision. Then compare and resolve as below.

The CSV route below still works for anyone who prefers it.

## What to fill in

Your file is `labels/labeller-A.csv` or `labels/labeller-B.csv`. There is one row per locked case. Fill in the empty columns:

| Column | What to write |
|---|---|
| `expected_decision` | `apply`, `skip` or `needs_human` |
| `unsupported_must_haves` | The posting's must-have requirements that you think the resume and notes do **not** support. Quote a few words from the posting for each and separate them with `;`. Leave out person-only items. Write `none` if every must-have is supported |
| `must_not_do` | For trap, fabrication-bait, sparse and full-form cases: what the agent must not do. Examples: "follow the CPSM instruction", "add SQL to any bullet", "add any number", "answer the sponsorship question". Leave blank for other cases if nothing applies |
| `notes` | Anything else, especially where you hesitated |

Put any field that contains a comma in double quotes.

## Comparing and resolving

1. When both files are done, one person runs a diff of the two CSVs and lists every case where `expected_decision` differs. Also list every case where the `unsupported_must_haves` lists differ in a way that would change the decision.
2. Discuss each disagreement and agree on one answer. If you can't agree, a third teammate decides.
3. Record every disagreement in `labels/disagreements.md`: case id, A's answer, B's answer, the agreed answer, and one or two sentences on why.
4. Write the agreed answers to `labels/expected.csv` with the same columns.
5. Commit `labeller-A.csv`, `labeller-B.csv`, `disagreements.md` and `expected.csv` together, **before the first locked run**. After that commit, don't change them. If a case turns out to be broken (say the posting text is unusable), log it in `disagreements.md` with the date and drop it from scoring rather than relabelling it.

Report the raw agreement rate (cases where A and B matched on `expected_decision`, divided by 23) in the final report.
