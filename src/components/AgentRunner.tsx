"use client";

import Link from "next/link";
import { useState, type ChangeEvent, type ReactNode } from "react";
import type { DecideResult } from "@/lib/agent/run";
import { FACTS_PROMPT } from "@/lib/agent/factsPrompt";
import { SAMPLE_NOTES, SAMPLE_POSTING, SAMPLE_RESUME } from "@/lib/agent/sample";
import type { RevertType, TailorResult } from "@/lib/agent/tailor";
import { MAX_JD_CHARS, MAX_NOTES_CHARS, MAX_UPLOAD_BYTES, MIN_JD_CHARS } from "@/lib/limits";
import base from "./Analyzer.module.css";
import styles from "./AgentRunner.module.css";

type Decide = Omit<DecideResult, "context">;
type RunResult = { mode: "ai" | "simulated"; decide: Decide; tailor: TailorResult | null; tailorError?: { code: string; message: string } };
type Inputs = { resumeText: string; posting: string; notes: string };

const DECISION: Record<Decide["decision"], { label: string; className: string }> = {
  apply: { label: "Apply", className: styles.apply },
  skip: { label: "Skip", className: styles.skip },
  needs_human: { label: "Needs a human", className: styles.human },
};

type TemplateChoice = "classic" | "modern" | "compact";
const TEMPLATE_CHOICES: { id: TemplateChoice; label: string; description: string }[] = [
  { id: "classic", label: "Classic", description: "Serif, centred name, ruled capital headings. The traditional business resume." },
  { id: "modern", label: "Modern", description: "Clean sans serif with navy headings and roles in italics." },
  { id: "compact", label: "Compact", description: "Small, tight sans serif for a full page of experience." },
];

const KIND: Record<string, string> = { skill: "Skill or experience", credential: "Credential", person: "Only the client can answer" };

const REVERT: Record<RevertType, string> = {
  new_number: "adds a number the facts don't have",
  new_date: "adds a date the facts don't have",
  new_name: "adds a name the facts don't have",
  new_contact: "adds contact details",
  new_skill: "claims something from the posting the facts don't show",
  scope_change: "makes the client's role sound bigger",
  self_praise: "praises the client instead of stating what they did",
  first_person: "is written in the first person",
  hidden_text: "contains hidden text",
  banned_opening: "starts with a weak opening",
  placeholder: "contains a placeholder",
  too_long: "is too long",
  keyword_overuse: "repeats a keyword too often",
  assembled_check: "failed the whole-resume check",
};

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function messageFrom(res: Response, body: Record<string, unknown> | null, fallback: string): string {
  const err = body?.error as { message?: string } | undefined;
  if (err?.message) return err.message;
  if (res.status === 413) return "This file is too large to upload. Please use a file under 4.5 MB.";
  return fallback;
}

/** Words in the rewrite that aren't in the original bullet are highlighted (REQ-AG-25). */
function highlightNew(original: string, rewrite: string): ReactNode[] {
  const known = new Set(original.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return rewrite.split(/(\s+)/).map((part, i) => {
    const words = part.toLowerCase().match(/[a-z0-9]+/g);
    return words && words.some((w) => !known.has(w)) ? <mark key={i}>{part}</mark> : part;
  });
}

async function upload(file: File, purpose?: string): Promise<{ text: string; hiddenText: string[] } | string> {
  if (file.size > MAX_UPLOAD_BYTES) return "This file is larger than 5 MB. Please upload a smaller file.";
  const form = new FormData();
  form.append("file", file);
  if (purpose) form.append("purpose", purpose);
  try {
    const res = await fetch("/api/extract", { method: "POST", body: form });
    const body = await readJson(res);
    if (!res.ok || !body) return messageFrom(res, body, "We couldn't read this file. Please try again.");
    return { text: String(body.text ?? ""), hiddenText: Array.isArray(body.hiddenText) ? body.hiddenText.map(String) : [] };
  } catch {
    return "Upload failed. Check your connection and try again.";
  }
}

export default function AgentRunner({ simulated }: { simulated: boolean }) {
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [hiddenText, setHiddenText] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [posting, setPosting] = useState("");
  const [postingUploading, setPostingUploading] = useState(false);
  const [postingError, setPostingError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [ranWith, setRanWith] = useState<Inputs | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [template, setTemplate] = useState<TemplateChoice>("classic");
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

  const postingLength = posting.trim().length;
  const postingValid = postingLength >= MIN_JD_CHARS && postingLength <= MAX_JD_CHARS;
  const canRun = resumeText !== null && resumeText.trim() !== "" && confirmed && postingValid && owner && !running;
  const blockers = [
    resumeText === null && "upload a resume or use the sample",
    resumeText !== null && !confirmed && "confirm the extracted text",
    !postingValid && "add the full job posting",
    !owner && "confirm the resume is yours or made up",
  ].filter(Boolean) as string[];

  function reset() {
    setResult(null);
    setRunError(null);
    setExportError(null);
  }

  function loadSample() {
    setResumeText(SAMPLE_RESUME);
    setHiddenText([]);
    setConfirmed(true);
    setPosting(SAMPLE_POSTING);
    setNotes(SAMPLE_NOTES);
    setOwner(true);
    setUploadError(null);
    setPostingError(null);
    reset();
  }

  async function onResumeFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setUploadError(null);
    setUploading(true);
    const out = await upload(file);
    setUploading(false);
    if (typeof out === "string") return setUploadError(out);
    setResumeText(out.text);
    setHiddenText(out.hiddenText);
    setConfirmed(false);
  }

  async function onPostingFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPostingError(null);
    setPostingUploading(true);
    const out = await upload(file, "job_description");
    setPostingUploading(false);
    if (typeof out === "string") return setPostingError(out);
    setPosting(out.text);
  }

  async function run(prepareAnyway = false) {
    if (resumeText === null) return;
    const inputs = { resumeText, posting, notes };
    setRunning(true);
    reset();
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...inputs, confirmed: true, ownResumeOrSynthetic: true, prepareAnyway }),
      });
      const body = await readJson(res);
      if (!res.ok || !body?.decide) return setRunError(messageFrom(res, body, "The agent run failed. Please try again."));
      setResult(body as unknown as RunResult);
      setRanWith(inputs);
    } catch {
      setRunError("The agent run failed. Check your connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  async function download(format: "pdf" | "docx") {
    if (!result?.tailor || !ranWith) return;
    setExporting(format);
    setExportError(null);
    try {
      const res = await fetch("/api/agent/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...ranWith, tailored: result.tailor.tailored, format, template }),
      });
      if (!res.ok) return setExportError(messageFrom(res, await readJson(res), "The download failed. Please try again."));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `tailored-resume-${template}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError("The download failed. Check your connection and try again.");
    } finally {
      setExporting(null);
    }
  }

  async function copy() {
    if (!result?.tailor) return;
    try {
      await navigator.clipboard.writeText(result.tailor.tailored);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setExportError("Copying isn't allowed in this browser. Select the text and copy it instead.");
    }
  }

  const d = result?.decide;
  const t = result?.tailor;

  return (
    <main className={base.main}>
      <p className={styles.nav}>
        <Link href="/">← Step 1: Keyword check</Link>
      </p>
      <header className={base.header}>
        <h1>Application Prep Agent</h1>
        <p className={base.lead}>
          Give it a resume and a job posting. It decides whether the posting is worth applying to, rewrites bullets using only facts the
          resume and notes already contain, and checks every rewrite before you see it. Nothing is stored or sent anywhere.
        </p>
      </header>

      {(simulated || result?.mode === "simulated") && (
        <p className={base.demo} role="note">
          Simulated mode: no AI is used, and results are a rough stand-in that doesn&apos;t count as evidence.
        </p>
      )}

      <section className={base.card}>
        <h2>Try it with a sample client</h2>
        <p className={base.hint}>Fills in a made-up resume, notes and a real-style posting so you can run the agent straight away.</p>
        <div className={styles.row}>
          <button type="button" className={styles.secondary} onClick={loadSample}>
            Use the sample client
          </button>
        </div>
      </section>

      <section className={base.card}>
        <h2>1. Resume</h2>
        <label className={base.label} htmlFor="agent-resume-file">
          Resume file (PDF or DOCX, up to 5 MB)
        </label>
        <input
          id="agent-resume-file"
          className={base.file}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onResumeFile}
          disabled={uploading}
        />
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
            <label className={base.label} htmlFor="agent-resume-text">
              Resume text
            </label>
            <p className={base.hint}>Fix anything that came out wrong. Only this text is used.</p>
            <textarea
              id="agent-resume-text"
              className={base.textarea}
              rows={12}
              value={resumeText}
              onChange={(e) => {
                setResumeText(e.target.value);
                setConfirmed(false);
              }}
            />
            <label className={base.checkbox}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I&apos;ve checked this text and it&apos;s correct
            </label>
          </>
        )}
      </section>

      <section className={base.card}>
        <h2>2. Job posting</h2>
        <label className={base.label} htmlFor="agent-posting">
          Posting text
        </label>
        <textarea
          id="agent-posting"
          className={base.textarea}
          rows={10}
          maxLength={MAX_JD_CHARS}
          value={posting}
          onChange={(e) => setPosting(e.target.value)}
          placeholder="Paste the full job posting here"
        />
        <p className={base.hint}>
          {postingLength.toLocaleString("en-US")} / {MAX_JD_CHARS.toLocaleString("en-US")} characters
          {postingLength < MIN_JD_CHARS && " (at least 300 characters needed)"}
        </p>
        <label className={base.label} htmlFor="agent-posting-file">
          Or upload the posting (PDF or DOCX)
        </label>
        <input
          id="agent-posting-file"
          className={base.file}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onPostingFile}
          disabled={postingUploading}
        />
        {postingUploading && <p className={base.status}>Reading the posting…</p>}
        {postingError && (
          <p className={base.error} role="alert">
            {postingError}
          </p>
        )}
      </section>

      <section className={base.card}>
        <h2>3. Notes (optional)</h2>
        <label className={base.label} htmlFor="agent-notes">
          True facts the resume leaves out
        </label>
        <textarea
          id="agent-notes"
          className={base.textarea}
          rows={4}
          maxLength={MAX_NOTES_CHARS}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="For example: used SQL for the 2022 audit; presented to the CFO twice"
        />
        <p className={base.hint}>The agent can use these in rewrites. Only add things that are true.</p>

        <details className={styles.facts}>
          <summary>Pull your projects from ChatGPT, Claude or another AI assistant</summary>
          <p className={base.hint}>
            An assistant that remembers your conversations often knows projects your resume leaves out. Copy this prompt into it,
            then paste its answer into the notes above.
          </p>
          <textarea className={base.textarea} rows={8} readOnly value={FACTS_PROMPT} aria-label="Prompt to copy into your AI assistant" />
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={copyFactsPrompt}>
              {promptCopied ? "Copied" : "Copy the prompt"}
            </button>
          </div>
          <p className={`${base.warning} ${styles.factsWarning}`}>
            Read every line before you paste it. The agent treats your notes as true, and assistants can misremember. Lines marked
            [unsure], and everything under THINGS TO CONFIRM, are ignored until you fix them and remove the mark.
          </p>
        </details>
      </section>

      <section className={base.card}>
        <h2>4. Run</h2>
        <label className={base.checkbox}>
          <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} />
          This resume is mine, or it&apos;s a made-up sample
        </label>
        <div className={styles.row}>
          <button type="button" className={base.button} disabled={!canRun} onClick={() => run(false)}>
            {running ? "Running…" : "Run the agent"}
          </button>
        </div>
        {running && <p className={base.status}>Reading the posting and checking the resume. This usually takes 10 to 30 seconds.</p>}
        {!canRun && !running && blockers.length > 0 && <p className={base.hint}>To run: {blockers.join(", ")}.</p>}
        {runError && (
          <p className={base.error} role="alert">
            {runError}
          </p>
        )}
      </section>

      {d && (
        <section className={base.card} aria-live="polite">
          <h2>Decision</h2>
          <p className={`${styles.decision} ${DECISION[d.decision].className}`}>{DECISION[d.decision].label}</p>
          <ul className={styles.reasons}>
            {d.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <p className={base.hint}>
            Evidence coverage counts must-have requirements with a quote from the resume or notes. It isn&apos;t an ATS score or a chance of
            getting the job.
          </p>

          {d.warnings.length > 0 && (
            <>
              <h3>Warnings</h3>
              <div className={base.warning} role="alert">
                <ul>
                  {d.warnings.map((w, i) => (
                    <li key={i}>
                      {w.kind.replace("_", " ")} in the {w.input}: &ldquo;{w.quote}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <h3>Requirements</h3>
          <div className={base.tableWrap}>
            <table className={base.table}>
              <thead>
                <tr>
                  <th>From the posting</th>
                  <th>Type</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {d.requirements.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.quote}
                      {r.priority === "nice" && <span className={base.hint}> (nice to have)</span>}
                    </td>
                    <td>{KIND[r.kind]}</td>
                    <td>
                      {r.kind === "person" ? (
                        <span className={base.hint}>Ask the client</span>
                      ) : r.evidence.length > 0 ? (
                        <ul className={styles.evidence}>
                          {r.evidence.map((e, j) => (
                            <li key={j}>&ldquo;{e}&rdquo;</li>
                          ))}
                        </ul>
                      ) : (
                        <span className={styles.none}>No evidence</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d.gaps.length > 0 && (
            <>
              <h3>Gaps to discuss with the client</h3>
              <p className={base.hint}>The agent won&apos;t add these to the resume. If one is true, add it to the notes and run again.</p>
              <ul className={styles.reasons}>
                {d.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}

          {d.personOnly.length > 0 && (
            <>
              <h3>Only the client can answer</h3>
              <ul className={styles.reasons}>
                {d.personOnly.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </>
          )}

          {!t && d.decision !== "apply" && (
            <div className={styles.row}>
              <button type="button" className={styles.secondary} disabled={running} onClick={() => run(true)}>
                Prepare anyway
              </button>
              <span className={base.hint}>Tailors the resume even though the agent didn&apos;t mark this apply.</span>
            </div>
          )}
          {result?.tailorError && (
            <p className={base.error} role="alert">
              {result.tailorError.message}
            </p>
          )}
        </section>
      )}

      {t && (
        <section className={base.card}>
          <h2>Tailored resume</h2>
          {t.preparedAnyway && <p className={base.badge}>Prepared anyway</p>}
          {t.angle && (
            <>
              <h3>The angle for this job</h3>
              <p className={styles.angle}>{t.angle}</p>
              <p className={base.hint}>What the rewrites aim to show. It isn&apos;t added to the resume.</p>
            </>
          )}

          {t.echo.total > 0 && (
            <>
              <h3>Posting language</h3>
              <p>
                Of the {t.echo.total} requirements the client meets, the resume states{" "}
                <strong>
                  {t.echo.before} before → {t.echo.after} after
                </strong>{" "}
                in words the posting uses.
              </p>
              <p className={base.hint}>
                A requirement counts when at least half its distinctive words appear. This shows whether the resume speaks the
                posting&apos;s language. It isn&apos;t an ATS score or a chance of getting through.
              </p>
            </>
          )}

          <h3>Rewrites kept ({t.kept.length})</h3>
          {t.kept.length === 0 && <p className={base.hint}>No bullet text changed for this job.</p>}
          {t.kept.map((k) => (
            <div key={k.bulletId} className={styles.pair}>
              <p className={styles.before}>{k.original}</p>
              <p className={styles.after}>{highlightNew(k.original, k.rewrite)}</p>
              {k.review && (
                <p className={styles.check}>
                  Check this is true here:{" "}
                  {k.review.map((r, i) => (
                    <span key={i}>
                      {i > 0 && "; "}&ldquo;{r.text}&rdquo; (from &ldquo;{r.requirement}&rdquo;, which the agent matched to a different part of the
                      resume)
                    </span>
                  ))}
                </p>
              )}
            </div>
          ))}

          {t.moved.length > 0 && (
            <>
              <h3>Moved to the top for this job ({t.moved.length})</h3>
              <p className={base.hint}>Each of these now leads its role or project. Nothing moved between roles.</p>
              <ul className={styles.reasons}>
                {t.moved.map((m) => (
                  <li key={m.bulletId}>{m.text}</li>
                ))}
              </ul>
            </>
          )}

          {t.skillsReordered.length > 0 && (
            <>
              <h3>Skills put in this job&apos;s order ({t.skillsReordered.length})</h3>
              {t.skillsReordered.map((r) => (
                <div key={r.lineId} className={styles.pair}>
                  <p className={styles.before}>{r.before}</p>
                  <p className={styles.after}>{r.after}</p>
                </div>
              ))}
            </>
          )}

          {t.reverted.length > 0 && (
            <>
              <h3>Rewrites thrown out ({t.reverted.length})</h3>
              <p className={base.hint}>These went back to the original bullet.</p>
              {t.reverted.map((r) => (
                <div key={r.bulletId} className={styles.pair}>
                  <p className={styles.after}>{r.rewrite}</p>
                  <p className={styles.why}>
                    {r.reasons.map((x, i) => (
                      <span key={i}>
                        {i > 0 && "; "}
                        {REVERT[x.type]}: &ldquo;{x.text}&rdquo;
                      </span>
                    ))}
                  </p>
                </div>
              ))}
            </>
          )}

          {t.questions.length > 0 && (
            <>
              <h3>Questions for the client</h3>
              <p className={base.hint}>True answers make this resume stronger for this job. Add them to the notes and run again.</p>
              <ol className={styles.reasons}>
                {t.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </>
          )}

          {t.strongerWithNumber.length > 0 && (
            <>
              <h3>Stronger with a number</h3>
              <p className={base.hint}>No number for these is in the facts. If the client has one, add it to the notes and run again.</p>
              <ul className={styles.reasons}>
                {t.strongerWithNumber.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}

          <h3>Full resume</h3>
          <pre className={styles.preview}>{t.tailored}</pre>
          <fieldset className={styles.templates}>
            <legend className={base.label}>Template</legend>
            {TEMPLATE_CHOICES.map((c) => (
              <label key={c.id} className={`${styles.template} ${template === c.id ? styles.templateOn : ""}`}>
                <input type="radio" name="template" value={c.id} checked={template === c.id} onChange={() => setTemplate(c.id)} />
                <span>
                  <strong>{c.label}</strong>
                  <span className={base.hint}>{c.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className={base.hint}>Every template fits the resume on one page when it can, by tightening spacing and type down to 9 pt.</p>
          <div className={styles.row}>
            <button type="button" className={base.button} disabled={exporting !== null} onClick={() => download("pdf")}>
              {exporting === "pdf" ? "Preparing…" : "Download PDF"}
            </button>
            <button type="button" className={styles.secondary} disabled={exporting !== null} onClick={() => download("docx")}>
              {exporting === "docx" ? "Preparing…" : "Download DOCX"}
            </button>
            <button type="button" className={styles.secondary} onClick={copy}>
              {copied ? "Copied" : "Copy text"}
            </button>
          </div>
          {exportError && (
            <p className={base.error} role="alert">
              {exportError}
            </p>
          )}
          <p className={styles.counts}>
            Rewrites suggested {t.counts.requested} · kept {t.counts.kept} · thrown out {t.counts.reverted} · bullets moved {t.counts.moved} · skills lines reordered {t.counts.skillLinesReordered}
          </p>
        </section>
      )}
    </main>
  );
}
