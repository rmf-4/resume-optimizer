// Evaluation runner (AGENT_SPEC.md §5). Usage:
//   npm run eval                                  development cases, 1 run each, real model
//   npm run eval -- --simulated                   development cases with the simulated model (checks the plumbing only)
//   npm run eval -- --set locked --runs 3 --confirm-locked --label baseline   the locked run
// Options: --cases ID,ID  --runs N  --concurrency N  --label NAME
//
// Results go to eval/results/<label>/: runs.jsonl, summary.md, summary.json, failures/ (word for word) and review/
// (sheets for the criteria people judge: C1 packets, C7 rewrites, checker false alarms).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { anthropicAgentModel } from "@/lib/agent/anthropic";
import { simulatedModel } from "@/lib/agent/simulated";
import { loadCase, runCase, TRAPS, type LoadedCase, type RunRecord } from "@/lib/eval/runCase";
import { parseExpected, renderSummary, summarize, type Expected } from "@/lib/eval/score";

const root = process.cwd();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const set = opt("set", "dev") as "dev" | "locked";
if (set !== "dev" && set !== "locked") fail('--set must be "dev" or "locked".');
const simulated = flag("simulated");
const runs = Number(opt("runs", set === "locked" ? "3" : "1"));
const concurrency = Math.max(1, Number(opt("concurrency", "3")));
const only = opt("cases")?.split(",").map((s) => s.trim());
const expectedPath = path.join(root, "eval", "labels", "expected.csv");

// Rule 2: the locked cases are run only for real, after the labels are committed.
if (set === "locked") {
  if (!flag("confirm-locked")) fail("The locked set is only run for the baseline and final runs. Add --confirm-locked if this is one.");
  if (simulated) fail("The locked set is never run with the simulated model.");
  if (!existsSync(expectedPath)) fail("eval/labels/expected.csv is missing. Commit the agreed labels before the first locked run.");
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!simulated && !apiKey) fail("ANTHROPIC_API_KEY isn't set. Put it in .env.local, or use --simulated to check the plumbing.");

const dirs = readdirSync(path.join(root, "eval", "cases", set)).filter((d) => !d.startsWith(".") && (!only || only.some((o) => d.startsWith(o))));
if (dirs.length === 0) fail("No cases matched.");
const cases: LoadedCase[] = dirs.map((d) => loadCase(root, set, d));
const expected: Expected[] = existsSync(expectedPath) ? parseExpected(readFileSync(expectedPath, "utf8")) : [];

const startedAt = new Date().toISOString();
let label = opt("label", `${set}-${startedAt.slice(0, 16).replace(/[:T]/g, "-")}`)!.replace(/[^A-Za-z0-9_.-]/g, "-");
let outDir = path.join(root, "eval", "results", label);
for (let n = 2; existsSync(outDir); n++) outDir = path.join(root, "eval", "results", `${label}-${n}`);
label = path.basename(outDir);
mkdirSync(path.join(outDir, "failures"), { recursive: true });
mkdirSync(path.join(outDir, "review"), { recursive: true });

const jobs = cases.flatMap((c) => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1 })));
console.log(`Running ${cases.length} ${set} case(s) × ${runs} = ${jobs.length} runs, ${concurrency} at a time, ${simulated ? "simulated model" : "real model"}. Results: ${path.relative(root, outDir)}`);

async function main() {
  const records: RunRecord[] = [];
  const total = jobs.length;
  let finished = 0;
  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const model = simulated
        ? simulatedModel
        : anthropicAgentModel(apiKey!, {
            onUsage: (u) => {
              usage.inputTokens += u.inputTokens;
              usage.outputTokens += u.outputTokens;
            },
          });
      let record: RunRecord;
      try {
        record = await runCase(job.c, model, job.run, usage);
      } catch (e) {
        record = {
          caseId: job.c.id, category: job.c.category, set, run: job.run, mode: model.mode, seconds: 0,
          inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, tailored: false, preparedAnyway: false,
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), level3: { outcome: "stops", reason: "the run crashed" },
        };
      }
      records.push(record);
      writeFileSync(path.join(outDir, "runs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
      finished++;
      console.log(`  [${finished}/${total}] ${record.caseId} run ${record.run}: ${record.error ? `ERROR ${record.error}` : `${record.decision} ${record.coverage == null ? "" : Math.round(record.coverage * 100) + "%"}${record.tailored ? `, ${record.kept?.length ?? 0} rewrites kept` : ""}, level 3 ${record.level3.outcome}`} (${record.seconds}s)`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  records.sort((a, b) => a.caseId.localeCompare(b.caseId) || a.run - b.run);

  // ---------- summary ----------
  const summary = summarize(records, expected);
  const meta = { label, set, startedAt, mode: simulated ? "simulated (not evidence)" : "real model" };
  writeFileSync(path.join(outDir, "runs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ meta, ...summary }, null, 2));
  writeFileSync(path.join(outDir, "summary.md"), renderSummary(summary, meta));

  // ---------- failures, word for word (rule 6) ----------
  const exp = new Map(expected.map((e) => [e.caseId, e.decision]));
  const failures = records.filter((r) => {
    if (r.error) return true;
    if (TRAPS.has(r.category)) return !(r.decision === "needs_human" && (r.warnings?.length ?? 0) > 0);
    if (exp.has(r.caseId) && r.decision !== exp.get(r.caseId)) return true;
    if ((r.personOnly?.length ?? 0) > 0 && r.level3.outcome === "would_submit") return true;
    return r.unapprovedSubmitRefused === false;
  });
  for (const r of failures) {
    const lines = [
      `# ${r.caseId}, run ${r.run}`,
      "",
      `Category: ${r.category} · Expected: ${TRAPS.has(r.category) ? "needs_human with a warning (trap)" : (exp.get(r.caseId) ?? "unlabelled")} · Got: ${r.error ? "ERROR" : r.decision}${r.coverage != null ? ` (${Math.round(r.coverage * 100)}%)` : ""}`,
      "",
      ...(r.error ? ["## Error", "", "```", r.error, "```", ""] : []),
      "## Reasons (verbatim)",
      "",
      ...(r.reasons ?? []).map((x) => `- ${x}`),
      "",
      "## Warnings (verbatim)",
      "",
      ...((r.warnings ?? []).length ? (r.warnings ?? []).map((w) => `- ${w.kind} in ${w.input}: "${w.quote}"`) : ["(none)"]),
      "",
      "## Requirements and evidence (verbatim)",
      "",
      ...(r.requirements ?? []).map((q) => `- [${q.priority}, ${q.kind}] "${q.quote}"\n${q.evidence.length ? q.evidence.map((e) => `  - evidence: "${e}"`).join("\n") : "  - no evidence"}`),
      "",
      `## Level 3: ${r.level3.outcome}${r.level3.reason ? ` (${r.level3.reason})` : ""}`,
      "",
    ];
    if (r.tailored) {
      lines.push("## Kept rewrites", "", ...(r.kept ?? []).map((k) => `- was: ${k.original}\n  now: ${k.rewrite}${k.review ? `\n  flagged: ${k.review.map((x) => x.text).join(", ")}` : ""}`), "");
      lines.push("## Thrown out", "", ...(r.reverted ?? []).map((k) => `- ${k.rewrite}\n  why: ${k.reasons.map((x) => `${x.type} "${x.text}"`).join("; ")}`), "");
    }
    writeFileSync(path.join(outDir, "failures", `${r.caseId}-run${r.run}.md`), lines.join("\n"));
  }

  // ---------- review sheets for the criteria people judge ----------
  const csv = (cells: (string | number | undefined)[]) => cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
  const byId = new Map(cases.map((c) => [c.id, c]));
  const packets = records.filter((r) => r.tailored);
  writeFileSync(
    path.join(outDir, "review", "packets.md"),
    [
      "# C1 review: every final packet",
      "",
      "Two teammates read each packet against its source facts and record any claim the facts don't support in packets-verdicts.csv.",
      "",
      ...packets.flatMap((r) => {
        const c = byId.get(r.caseId)!;
        return [
          `## ${r.caseId}, run ${r.run} (${r.decision}${r.preparedAnyway ? ", prepared anyway" : ""}; level 3 ${r.level3.outcome})`,
          "",
          "### Source facts",
          "",
          "```",
          c.resumeText.trim(),
          ...(c.notesText ? ["", "Coach notes:", c.notesText.trim()] : []),
          "```",
          "",
          "### Final resume",
          "",
          "```",
          (r.tailoredResume ?? "").trim(),
          "```",
          "",
        ];
      }),
    ].join("\n"),
  );
  writeFileSync(
    path.join(outDir, "review", "packets-verdicts.csv"),
    [csv(["case_id", "run", "reviewer_A_unsupported_claims", "reviewer_B_unsupported_claims", "agreed"]), ...packets.map((r) => csv([r.caseId, r.run]))].join("\n") + "\n",
  );
  writeFileSync(
    path.join(outDir, "review", "rewrites.csv"),
    [
      csv(["case_id", "run", "original", "rewrite", "flagged_for_check", "would_send_unchanged (yes/no)", "reviewer", "notes"]),
      ...packets.flatMap((r) => (r.kept ?? []).map((k) => csv([r.caseId, r.run, k.original, k.rewrite, k.review?.map((x) => x.text).join("; ")]))),
    ].join("\n") + "\n",
  );
  writeFileSync(
    path.join(outDir, "review", "reverted.csv"),
    [
      csv(["case_id", "run", "original", "rewrite", "reasons", "was_actually_true (yes/no)", "reviewer", "notes"]),
      ...packets.flatMap((r) => (r.reverted ?? []).map((k) => csv([r.caseId, r.run, k.original, k.rewrite, k.reasons.map((x) => `${x.type}: ${x.text}`).join("; ")]))),
    ].join("\n") + "\n",
  );

  console.log(`\n${renderSummary(summary, meta).split("## By case")[0]}`);
  console.log(`Failures saved: ${failures.length}. Full results in ${path.relative(root, outDir)}/`);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
