"use client";

// The one workflow (AGENT_SPEC.md, "How a run works"): resume → what your AI knows → questions → stronger resume →
// jobs → tailor and export. Everything the user enters is kept in this browser only, never on the server.

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { answersToNotes, FACTS_PROMPT } from "@/lib/agent/factsPrompt";
import type { ImproveResult } from "@/lib/agent/improve";
import type { InterviewQuestion } from "@/lib/agent/interview";
import { SAMPLE_NOTES, SAMPLE_POSTING, SAMPLE_RESUME } from "@/lib/agent/sample";
import type { InputWarning } from "@/lib/agent/warnings";
import { MAX_JD_CHARS, MIN_JD_CHARS } from "@/lib/limits";
import base from "../Analyzer.module.css";
import styles from "../AgentRunner.module.css";
import { buildPacket } from "@/lib/agent/packetShape";
import { ApprovalPanel, DECISION, JobResult, MockLog, type LogEntryView, type RunResult } from "./JobResult";
import { ExportPanel, highlightNew, postJson, reasonsText, uploadFile } from "./shared";

const STORAGE_KEY = "application-prep-agent.v1";
const MAX_JOBS = 10;

type Job = { id: string; title: string; text: string; url?: string };
type AutoOutcome = { status: "submitted"; entry: LogEntryView } | { status: "stopped"; reason: string };
type JobRun = { status: "running" | "done" | "failed"; result?: RunResult; error?: string; auto?: AutoOutcome; submitted?: LogEntryView };
type Master = { text: string; accepted: boolean };
type Saved = {
  resumeText: string | null;
  confirmed: boolean;
  owner: boolean;
  notes: string;
  questions: InterviewQuestion[];
  answers: Record<number, string>;
  master: Master | null;
  jobs: Job[];
};

const EMPTY: Saved = { resumeText: null, confirmed: false, owner: false, notes: "", questions: [], answers: {}, master: null, jobs: [] };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Saved>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

const STEPS = ["Your resume", "What your AI knows", "Questions", "Stronger resume", "Jobs", "Tailor and export"] as const;

const KIND_LABEL: Record<InterviewQuestion["kind"], string> = {
  clarify: "What exactly",
  meaning: "What it means",
  number: "A number",
  tool: "Tools",
  result: "The result",
  missing: "Not on your resume yet",
};

function titleOf(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "Job posting";
  return first.trim().slice(0, 90);
}

function rank(run?: JobRun): number {
  if (!run?.result) return run?.status === "running" ? 4 : 5;
  const d = run.result.decide;
  const order = { apply: 0, needs_human: 1, skip: 2 }[d.decision];
  return order + (1 - (d.coverage ?? 0)) * 0.99;
}

export default function AgentFlow({ simulated }: { simulated: boolean }) {
  const [saved, setSaved] = useState<Saved>(load);
  const [step, setStep] = useState(() => (load().resumeText ? 1 : 0));
  const patch = (p: Partial<Saved>) => setSaved((s) => ({ ...s, ...p }));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private window or storage blocked: the page still works, it just won't remember.
    }
  }, [saved]);

  const { resumeText, confirmed, owner, notes, questions, answers, master, jobs } = saved;
  const ready = resumeText !== null && resumeText.trim() !== "" && confirmed && owner;
  const allNotes = useMemo(
    () => [notes.trim(), answersToNotes(questions.map((q) => ({ question: q.question, answer: answers[q.id] ?? "" })))].filter(Boolean).join("\n\n"),
    [notes, questions, answers],
  );
  const baseResume = master?.accepted ? master.text : (resumeText ?? "");
  const identity = { confirmed: true, ownResumeOrSynthetic: true };

  // ---------- step 1 ----------
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hiddenText, setHiddenText] = useState<string[]>([]);

  const [dragging, setDragging] = useState(false);
  async function onResumeFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await handleResumeFile(file);
    e.target.value = "";
  }

  async function handleResumeFile(file: File) {
    setUploadError(null);
    setUploading(true);
    const out = await uploadFile(file);
    setUploading(false);
    if (typeof out === "string") return setUploadError(out);
    setHiddenText(out.hiddenText);
    patch({ resumeText: out.text, confirmed: false, master: null, questions: [], answers: {} });
    setImprove(null);
    setRuns({});
  }

  function loadSample() {
    setSaved({ ...EMPTY, resumeText: SAMPLE_RESUME, confirmed: true, owner: true, notes: SAMPLE_NOTES, jobs: [{ id: "sample", title: titleOf(SAMPLE_POSTING), text: SAMPLE_POSTING }] });
    setImprove(null);
    setRuns({});
    setHiddenText([]);
  }

  function forgetEverything() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // nothing stored
    }
    setSaved(EMPTY);
    setImprove(null);
    setRuns({});
    setStep(0);
  }

  // ---------- step 2 ----------
  const [promptCopied, setPromptCopied] = useState(false);
  async function copyFactsPrompt() {
    try {
      await navigator.clipboard.writeText(FACTS_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      setPromptCopied(false);
    }
  }

  // ---------- step 3 ----------
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askWarnings, setAskWarnings] = useState<InputWarning[]>([]);
  async function askQuestions() {
    setAsking(true);
    setAskError(null);
    const out = await postJson<{ questions: InterviewQuestion[]; warnings: InputWarning[] }>(
      "/api/agent/interview",
      { resumeText, notes, ...identity },
      "The questions couldn't be prepared.",
    );
    setAsking(false);
    if (!out.ok) return setAskError(out.message);
    patch({ questions: out.data.questions, answers: {} });
    setAskWarnings(out.data.warnings);
  }

  // ---------- step 4 ----------
  type Improved = ImproveResult & { mode: "ai" | "simulated" };
  const [improve, setImprove] = useState<Improved | null>(null);
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState<string | null>(null);
  async function buildMaster() {
    setImproving(true);
    setImproveError(null);
    const out = await postJson<Improved>("/api/agent/improve", { resumeText, notes: allNotes, ...identity }, "The stronger resume couldn't be built.");
    setImproving(false);
    if (!out.ok) return setImproveError(out.message);
    setImprove(out.data);
    patch({ master: { text: out.data.master, accepted: false } });
  }

  // ---------- step 5 ----------
  const [jobInput, setJobInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, JobRun>>({});
  const [checking, setChecking] = useState(false);

  async function addJob() {
    const input = jobInput.trim();
    if (!input) return;
    if (jobs.length >= MAX_JOBS) return setJobError(`You can check up to ${MAX_JOBS} jobs at a time. Remove one first.`);
    setJobError(null);
    if (/^https?:\/\//i.test(input) && !/\s/.test(input)) {
      setAdding(true);
      const out = await postJson<{ posting: { title: string; company: string; text: string; url: string } }>("/api/agent/posting", { url: input }, "That link couldn't be read.");
      setAdding(false);
      if (!out.ok) return setJobError(out.message);
      const p = out.data.posting;
      patch({ jobs: [...jobs, { id: crypto.randomUUID(), title: `${p.title} · ${p.company}`, text: p.text, url: p.url }] });
    } else {
      if (input.length < MIN_JD_CHARS) return setJobError("Paste the full posting (at least 300 characters), or a link to it.");
      if (input.length > MAX_JD_CHARS) return setJobError("That posting is longer than 20,000 characters. Paste the part with the role and requirements.");
      patch({ jobs: [...jobs, { id: crypto.randomUUID(), title: titleOf(input), text: input }] });
    }
    setJobInput("");
  }

  // Level 3: started by a person with the passcode, kept in memory only, ends after an hour (REQ-AG-30).
  const [level3, setLevel3] = useState<{ token: string; until: number } | null>(null);
  const [level3Pass, setLevel3Pass] = useState("");
  const [level3Error, setLevel3Error] = useState<string | null>(null);
  const level3On = level3 !== null && level3.until > Date.now();

  async function startLevel3() {
    setLevel3Error(null);
    const out = await postJson<{ token: string; expiresInSeconds: number }>("/api/agent/level3", { passcode: level3Pass }, "Level 3 couldn't be turned on.");
    if (!out.ok) return setLevel3Error(out.message);
    setLevel3({ token: out.data.token, until: Date.now() + out.data.expiresInSeconds * 1000 });
    setLevel3Pass("");
  }

  async function runJob(job: Job, prepareAnyway = false) {
    setRuns((r) => ({ ...r, [job.id]: { ...r[job.id], status: "running" } }));
    const payload = { resumeText: baseResume, notes: allNotes, posting: job.text, ...identity };
    if (level3On && !prepareAnyway) {
      const out = await postJson<RunResult & { auto: AutoOutcome }>(
        "/api/agent/auto",
        { ...payload, postingTitle: job.title, level3Token: level3!.token },
        "This job couldn't be checked.",
      );
      setRuns((r) => ({
        ...r,
        [job.id]: out.ok
          ? { status: "done", result: out.data, auto: out.data.auto, submitted: out.data.auto.status === "submitted" ? out.data.auto.entry : undefined }
          : { status: "failed", error: out.message, result: r[job.id]?.result },
      }));
      return;
    }
    const out = await postJson<RunResult>("/api/agent/run", { ...payload, prepareAnyway }, "This job couldn't be checked.");
    setRuns((r) => ({ ...r, [job.id]: out.ok ? { status: "done", result: out.data } : { status: "failed", error: out.message, result: r[job.id]?.result } }));
  }

  async function checkAllJobs() {
    setChecking(true);
    const queue = jobs.filter((j) => runs[j.id]?.status !== "done");
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await runJob(job);
    };
    await Promise.all([worker(), worker()]);
    setChecking(false);
  }

  const ranked = [...jobs].sort((a, b) => rank(runs[a.id]) - rank(runs[b.id]));

  // ---------- step 6 ----------
  const [selected, setSelected] = useState<string | null>(null);
  const selectedJob = jobs.find((j) => j.id === selected) ?? ranked.find((j) => runs[j.id]?.result);
  const selectedRun = selectedJob ? runs[selectedJob.id] : undefined;

  // ---------- layout ----------
  const reachable = (i: number) => i === 0 || ready;

  return (
    <main className={base.main}>
      <header className={base.header}>
        <p className={styles.brand}>Application Prep Agent</p>
        <h1>Turn the resume you have into the one each job needs.</h1>
        <p className={base.lead}>
          Start with the resume you have. The agent asks what it needs to know, builds a stronger version using only what&apos;s true, then
          checks each job you&apos;re looking at and tailors your resume to the ones worth applying to.
        </p>
      </header>

      {simulated && (
        <p className={base.demo} role="note">
          Simulated mode: no AI is used, and results are a rough stand-in that doesn&apos;t count as evidence.
        </p>
      )}

      <nav aria-label="Steps">
        <ol className={styles.progress}>
          {STEPS.map((label, i) => {
            const done = i < step && reachable(i);
            return (
              <li key={label} className={styles.progressItem}>
                <button
                  type="button"
                  className={`${styles.progressStep} ${step === i ? styles.progressCurrent : ""} ${done ? styles.progressDone : ""}`}
                  disabled={!reachable(i)}
                  aria-current={step === i ? "step" : undefined}
                  onClick={() => setStep(i)}
                >
                  <span className={styles.progressDot} aria-hidden="true">
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={styles.progressLabel}>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 0 && (
        <section className={base.card}>
          <p className={styles.eyebrow}>Step 1 of 6</p>
          <h2>Your resume</h2>
          <p className={base.hint}>Start with the resume you have now, even if it needs work. It stays in this browser.</p>
          <label
            className={`${styles.dropzone} ${dragging ? styles.dropzoneOn : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleResumeFile(file);
            }}
          >
            <input
              id="flow-resume-file"
              className={styles.visuallyHidden}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={onResumeFile}
              disabled={uploading}
            />
            <span className={styles.dropzoneTitle}>{resumeText === null ? "Drop your resume here" : "Drop a different resume here"}</span>
            <span className={base.hint}>or click to choose a PDF or Word file, up to 5 MB</span>
          </label>
          <div className={styles.divider}>
            <span>or</span>
          </div>
          <div className={styles.rowCenter}>
            <button type="button" className={styles.secondary} onClick={loadSample}>
              Try it with a made-up sample
            </button>
          </div>
          {uploading && <p className={base.status}>Reading your file…</p>}
          {uploadError && (
            <p className={base.error} role="alert">
              {uploadError}
            </p>
          )}
          {resumeText !== null && (
            <>
              {hiddenText.length > 0 && (
                <div className={base.warning} role="alert">
                  <p>
                    <strong>Hidden text was removed from the resume:</strong>
                  </p>
                  <ul>
                    {hiddenText.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              )}
              <label className={base.label} htmlFor="flow-resume-text">
                Resume text
              </label>
              <p className={base.hint}>Fix anything that came out wrong. Only this text is used.</p>
              <textarea
                id="flow-resume-text"
                className={base.textarea}
                rows={12}
                value={resumeText}
                onChange={(e) => patch({ resumeText: e.target.value, confirmed: false, master: null })}
              />
              <label className={base.checkbox}>
                <input type="checkbox" checked={confirmed} onChange={(e) => patch({ confirmed: e.target.checked })} />
                I&apos;ve checked this text and it&apos;s correct
              </label>
              <label className={base.checkbox}>
                <input type="checkbox" checked={owner} onChange={(e) => patch({ owner: e.target.checked })} />
                This resume is mine, or it&apos;s a made-up sample
              </label>
            </>
          )}
          <div className={styles.row}>
            <button type="button" className={base.button} disabled={!ready} onClick={() => setStep(1)}>
              Next: what your AI knows
            </button>
            {resumeText !== null && (
              <button type="button" className={styles.secondary} onClick={forgetEverything}>
                Forget everything
              </button>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className={base.card}>
          <p className={styles.eyebrow}>Step 2 of 6</p>
          <h2>What your AI knows about you</h2>
          <p className={base.hint}>
            ChatGPT, Claude and other assistants that remember your conversations often know projects your resume leaves out. Copy this prompt
            into yours, read its answer, then paste it below. Skip this step if you like.
          </p>
          <textarea className={base.textarea} rows={7} readOnly value={FACTS_PROMPT} aria-label="Prompt to copy into your AI assistant" />
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={copyFactsPrompt}>
              {promptCopied ? "Copied" : "Copy the prompt"}
            </button>
          </div>
          <label className={base.label} htmlFor="flow-notes">
            Your notes: the assistant&apos;s answer, and any other true facts
          </label>
          <textarea id="flow-notes" className={base.textarea} rows={8} value={notes} onChange={(e) => patch({ notes: e.target.value })} />
          <p className={`${base.warning} ${styles.factsWarning}`}>
            Read every line before you continue. The agent treats your notes as true, and assistants can misremember. Lines marked [unsure],
            and everything under THINGS TO CONFIRM, are ignored until you fix them and remove the mark.
          </p>
          <div className={styles.row}>
            <button type="button" className={base.button} onClick={() => setStep(2)}>
              Next: questions
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className={base.card}>
          <p className={styles.eyebrow}>Step 3 of 6</p>
          <h2>Questions before anything changes</h2>
          <p className={base.hint}>
            The agent reads your resume and notes and asks what it needs to know to make them stronger: what you did, what a phrase means, the
            numbers. Your answers become facts it can use. Skip any you can&apos;t answer.
          </p>
          {questions.length === 0 && (
            <div className={styles.row}>
              <button type="button" className={base.button} disabled={asking} onClick={askQuestions}>
                {asking ? "Reading your resume…" : "Ask me questions"}
              </button>
            </div>
          )}
          {asking && <p className={base.status}>This usually takes 10 to 30 seconds.</p>}
          {askError && (
            <p className={base.error} role="alert">
              {askError}
            </p>
          )}
          {askWarnings.length > 0 && (
            <div className={base.warning} role="alert">
              <ul>
                {askWarnings.map((w, i) => (
                  <li key={i}>
                    {w.kind.replace("_", " ")} in the {w.input}: &ldquo;{w.quote}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          )}
          {questions.map((q) => (
            <div key={q.id} className={styles.question}>
              <p className={styles.questionTopic}>
                {q.topic} · <span className={base.hint}>{KIND_LABEL[q.kind]}</span>
              </p>
              <label className={base.label} htmlFor={`answer-${q.id}`}>
                {q.question}
              </label>
              <textarea
                id={`answer-${q.id}`}
                className={base.textarea}
                rows={2}
                value={answers[q.id] ?? ""}
                placeholder="Your answer, or leave blank to skip"
                onChange={(e) => patch({ answers: { ...answers, [q.id]: e.target.value } })}
              />
            </div>
          ))}
          <div className={styles.row}>
            <button type="button" className={base.button} onClick={() => setStep(3)}>
              {questions.length ? "Next: build my stronger resume" : "Skip the questions"}
            </button>
            {questions.length > 0 && (
              <button type="button" className={styles.secondary} disabled={asking} onClick={askQuestions}>
                Ask new questions
              </button>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className={base.card}>
          <p className={styles.eyebrow}>Step 4 of 6</p>
          <h2>Your stronger resume</h2>
          <p className={base.hint}>
            Built from your resume, notes and answers, for no particular job yet. Every line is checked against those facts; anything unsupported is
            thrown out. Review it, then use it as the base for every job.
          </p>
          <div className={styles.row}>
            <button type="button" className={base.button} disabled={improving} onClick={buildMaster}>
              {improving ? "Building…" : master ? "Build it again" : "Build my stronger resume"}
            </button>
          </div>
          {improving && <p className={base.status}>This usually takes 20 to 40 seconds.</p>}
          {improveError && (
            <p className={base.error} role="alert">
              {improveError}
            </p>
          )}

          {improve && (
            <>
              <h3>Rewrites ({improve.kept.length})</h3>
              {improve.kept.map((k) => (
                <div key={k.bulletId} className={styles.pair}>
                  <p className={styles.before}>{k.original}</p>
                  <p className={styles.after}>{highlightNew(k.original, k.rewrite)}</p>
                </div>
              ))}
              {improve.addedBullets.length > 0 && (
                <>
                  <h3>New bullets from your notes and answers ({improve.addedBullets.length})</h3>
                  {improve.addedBullets.map((b, i) => (
                    <div key={i} className={styles.pair}>
                      <p className={base.hint}>{b.entry}</p>
                      <p className={styles.after}>
                        <mark>{b.text}</mark>
                      </p>
                    </div>
                  ))}
                </>
              )}
              {improve.addedEntries.length > 0 && (
                <>
                  <h3>New projects or roles ({improve.addedEntries.length})</h3>
                  {improve.addedEntries.map((e, i) => (
                    <div key={i} className={styles.pair}>
                      <p className={base.hint}>Under {e.section}</p>
                      <p className={styles.after}>
                        <strong>{e.title}</strong>
                      </p>
                      <ul className={styles.reasons}>
                        {e.bullets.map((b, j) => (
                          <li key={j}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
              {(improve.reverted.length > 0 || improve.rejected.length > 0) && (
                <details className={styles.facts}>
                  <summary>Thrown out ({improve.reverted.length + improve.rejected.length})</summary>
                  {improve.reverted.map((r) => (
                    <div key={`r${r.bulletId}`} className={styles.pair}>
                      <p className={styles.after}>{r.rewrite}</p>
                      <p className={styles.why}>{reasonsText(r.reasons)}</p>
                    </div>
                  ))}
                  {improve.rejected.map((r, i) => (
                    <div key={`n${i}`} className={styles.pair}>
                      <p className={styles.after}>{r.text}</p>
                      <p className={styles.why}>{reasonsText(r.reasons)}</p>
                    </div>
                  ))}
                </details>
              )}
            </>
          )}

          {master && (
            <>
              <h3>Full resume</h3>
              <pre className={styles.preview}>{master.text}</pre>
              <ExportPanel text={master.text} resumeText={resumeText ?? ""} notes={allNotes} fileStem="resume" />
              <div className={styles.row}>
                <button
                  type="button"
                  className={base.button}
                  onClick={() => {
                    patch({ master: { ...master, accepted: true } });
                    setRuns({});
                    setStep(4);
                  }}
                >
                  {master.accepted ? "Using this one. Next: jobs" : "Use this as my resume"}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    patch({ master: { ...master, accepted: false } });
                    setRuns({});
                    setStep(4);
                  }}
                >
                  Keep my original instead
                </button>
              </div>
            </>
          )}
          {!master && (
            <div className={styles.row}>
              <button type="button" className={styles.secondary} onClick={() => setStep(4)}>
                Skip: use my original resume
              </button>
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section className={base.card}>
          <p className={styles.eyebrow}>Step 5 of 6</p>
          <h2>Jobs you&apos;re looking at</h2>
          <p className={base.hint}>
            Add up to {MAX_JOBS} jobs. Paste a link from Greenhouse, Lever, Ashby or SmartRecruiters, or paste the posting text. The agent tells you
            which are worth applying to, and why.
          </p>
          <p className={base.hint}>Using: {master?.accepted ? "your stronger resume" : "your original resume"}.</p>
          <label className={base.label} htmlFor="flow-job">
            Job link or posting text
          </label>
          <textarea
            id="flow-job"
            className={base.textarea}
            rows={3}
            value={jobInput}
            onChange={(e) => setJobInput(e.target.value)}
            placeholder="https://jobs.lever.co/… or the full posting"
          />
          <div className={styles.row}>
            <button type="button" className={styles.secondary} disabled={adding || !jobInput.trim()} onClick={addJob}>
              {adding ? "Reading the link…" : "Add job"}
            </button>
          </div>
          {jobError && (
            <p className={base.error} role="alert">
              {jobError}
            </p>
          )}

          {jobs.length > 0 && (
            <>
              <div className={base.tableWrap}>
                <table className={base.table}>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Verdict</th>
                      <th>Evidence</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((j) => {
                      const run = runs[j.id];
                      const d = run?.result?.decide;
                      return (
                        <tr key={j.id}>
                          <td>{j.title}</td>
                          <td>
                            {run?.status === "running" && <span className={base.hint}>Checking…</span>}
                            {run?.status === "failed" && <span className={styles.none}>{run.error}</span>}
                            {d && <span className={`${styles.decisionSmall} ${DECISION[d.decision].className}`}>{DECISION[d.decision].label}</span>}
                            {run?.submitted && <div className={base.hint}>Submitted{run.submitted.level === 3 ? " automatically" : ""}</div>}
                            {run?.auto?.status === "stopped" && <div className={base.hint}>Level 3 stopped: {run.auto.reason}</div>}
                            {!run && <span className={base.hint}>Not checked</span>}
                          </td>
                          <td>{d?.coverage != null ? `${Math.round(d.coverage * 100)}%` : ""}</td>
                          <td className={styles.rowActions}>
                            {run?.result && (
                              <button
                                type="button"
                                className={styles.linkButton}
                                onClick={() => {
                                  setSelected(j.id);
                                  setStep(5);
                                }}
                              >
                                Open
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.linkButton}
                              disabled={run?.status === "running"}
                              onClick={() => {
                                patch({ jobs: jobs.filter((x) => x.id !== j.id) });
                                setRuns(({ [j.id]: _gone, ...rest }) => {
                                  void _gone;
                                  return rest;
                                });
                              }}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={`${styles.level3} ${level3On ? styles.level3On : ""}`}>
                <strong>Level 3: submit clean jobs automatically</strong>
                <p className={base.hint}>
                  When it&apos;s on, the agent submits a job to the team&apos;s mock application site by itself only if it&apos;s an Apply with no
                  warnings, nothing for you to confirm, and no questions only you can answer. Everything else stops and waits for you. It never
                  submits to a real employer.
                </p>
                {level3On ? (
                  <div className={styles.row}>
                    <span>On until {new Date(level3!.until).toLocaleTimeString()}.</span>
                    <button type="button" className={styles.secondary} onClick={() => setLevel3(null)}>
                      Turn off
                    </button>
                  </div>
                ) : (
                  <div className={styles.row}>
                    <input
                      className={styles.input}
                      type="password"
                      placeholder="Passcode"
                      aria-label="Passcode to turn on level 3"
                      autoComplete="off"
                      value={level3Pass}
                      onChange={(e) => setLevel3Pass(e.target.value)}
                    />
                    <button type="button" className={styles.secondary} disabled={!level3Pass} onClick={startLevel3}>
                      Turn on level 3
                    </button>
                  </div>
                )}
                {level3Error && (
                  <p className={base.error} role="alert">
                    {level3Error}
                  </p>
                )}
              </div>
              <div className={styles.row}>
                <button type="button" className={base.button} disabled={checking || jobs.every((j) => runs[j.id]?.status === "done")} onClick={checkAllJobs}>
                  {checking ? "Checking jobs…" : level3On ? "Check my jobs and auto-submit the clean ones" : "Check my jobs"}
                </button>
              </div>
              {checking && <p className={base.status}>About a minute per job, two at a time.</p>}
            </>
          )}
        </section>
      )}

      {step === 5 && (
        <>
          {jobs.some((j) => runs[j.id]?.result) && (
            <nav className={styles.jobTabs} aria-label="Checked jobs">
              {ranked
                .filter((j) => runs[j.id]?.result)
                .map((j) => {
                  const d = runs[j.id]!.result!.decide;
                  return (
                    <button
                      key={j.id}
                      type="button"
                      className={`${styles.jobTab} ${selectedJob?.id === j.id ? styles.stepOn : ""}`}
                      onClick={() => setSelected(j.id)}
                    >
                      <span className={`${styles.decisionSmall} ${DECISION[d.decision].className}`}>{DECISION[d.decision].label}</span>
                      {j.title}
                    </button>
                  );
                })}
            </nav>
          )}
          {selectedJob && selectedRun?.result ? (
            <JobResult
              key={selectedJob.id}
              title={selectedJob.title}
              result={selectedRun.result}
              resumeText={baseResume}
              notes={allNotes}
              posting={selectedJob.text}
              running={selectedRun.status === "running"}
              onPrepareAnyway={() => runJob(selectedJob, true)}
              fileStem={`resume-${selectedJob.title.split(" · ")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`}
            />
          ) : null}
          {selectedJob && selectedRun?.auto?.status === "stopped" && !selectedRun.submitted && (
            <p className={`${base.warning} ${styles.factsWarning}`}>Level 3 stopped on this job: {selectedRun.auto.reason} Review it and approve it yourself below, or leave it.</p>
          )}
          {selectedJob && selectedRun?.result?.tailor && (
            <ApprovalPanel
              key={`approve-${selectedJob.id}`}
              packet={buildPacket({
                postingTitle: selectedJob.title,
                posting: selectedJob.text,
                decide: selectedRun.result.decide,
                tailor: selectedRun.result.tailor,
                mode: selectedRun.result.mode,
              })}
              resumeText={baseResume}
              notes={allNotes}
              submitted={selectedRun.submitted}
              onSubmitted={(entry) => setRuns((r) => ({ ...r, [selectedJob.id]: { ...r[selectedJob.id], submitted: entry } }))}
            />
          )}
          {!(selectedJob && selectedRun?.result) && (
            <section className={base.card}>
              <p className={styles.eyebrow}>Step 6 of 6</p>
          <h2>Tailor and export</h2>
              <p className={base.hint}>Check your jobs in step 5 first. Each one you open here gets its own tailored resume to download.</p>
              <div className={styles.row}>
                <button type="button" className={styles.secondary} onClick={() => setStep(4)}>
                  Back to jobs
                </button>
              </div>
            </section>
          )}
          <MockLog />
        </>
      )}
    </main>
  );
}
