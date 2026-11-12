"""Turns a filled labelling workbook into labels/labeller-<X>.csv.

Usage: python eval/labels/workbooks/to_csv.py <filled-workbook.xlsx> <A|B>
Reads the yellow answer boxes on each case tab (B3:B6) directly, so it works whether or not the app that saved
the workbook recalculated the Answers tab. Needs openpyxl (pip install openpyxl).
"""
import csv, glob, json, os, sys
from openpyxl import load_workbook

book, who = sys.argv[1], sys.argv[2].upper()
root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ids = {os.path.basename(os.path.dirname(p)).split("-")[0]: json.load(open(p))["id"] for p in glob.glob(os.path.join(root, "eval/cases/locked/*/case.json"))}
wb = load_workbook(book, data_only=True)
out = os.path.join(root, "eval", "labels", f"labeller-{who}.csv")
rows, problems = [], []
for short in sorted(ids):
    ws = wb[short]
    cells = [("" if ws[f"B{r}"].value is None else str(ws[f"B{r}"].value).strip()) for r in range(3, 7)]
    if cells[0] not in ("apply", "skip", "needs_human"):
        problems.append(f"{short}: expected decision is '{cells[0]}'")
    rows.append([ids[short], *cells])
with open(out, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["case_id", "expected_decision", "unsupported_must_haves", "must_not_do", "notes"])
    w.writerows(rows)
print(f"Wrote {os.path.relpath(out, root)} with {len(rows)} cases.")
if problems:
    print("Check these before committing:\n  " + "\n  ".join(problems))
