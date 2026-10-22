"use client";

import { useState, type ChangeEvent } from "react";
import { MAX_JD_CHARS, MAX_UPLOAD_BYTES, MIN_JD_CHARS } from "@/lib/limits";
import type { Step1Report } from "@/lib/step1/types";
import styles from "./Analyzer.module.css";

type ApiError = { code: string; message: string };

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errorFrom(res: Response, body: Record<string, unknown> | null, fallback: string): string {
  const err = body?.error as ApiError | undefined;
  if (err?.message) return err.message;
  // Vercel rejects request bodies over ~4.5 MB before they reach our code.
  if (res.status === 413) return "This file is too large to upload. Please use a file under 4.5 MB.";
  return fallback;
}

const REASON_LABELS: Record<string, string> = {
  generic: "Generic",
  "no measurable impact": "No measurable impact",
  "passive phrasing": "Passive phrasing",
};

export default function Analyzer({ demoMode }: { demoMode: boolean }) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [hiddenText, setHiddenText] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [jdUploading, setJdUploading] = useState(false);
  const [jdUploadError, setJdUploadError] = useState<string | null>(null);
  const [jdHiddenText, setJdHiddenText] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [report, setReport] = useState<Step1Report | null>(null);

  const jdLength = jobDescription.trim().length;
  const jdValid = jdLength >= MIN_JD_CHARS && jdLength <= MAX_JD_CHARS;
  const canAnalyze = resumeText !== null && resumeText.trim() !== "" && confirmed && jdValid && !analyzing;

  const blockers = [
    resumeText === null && "upload your resume",
    resumeText !== null && !confirmed && "confirm the extracted text",
    !jdValid && "add the full job description",
  ].filter(Boolean) as string[];

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setReport(null);
    setAnalyzeError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("This file is larger than 5 MB. Please upload a smaller file.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const body = await readJson(res);
      if (!res.ok || !body) {
        setUploadError(errorFrom(res, body, "We couldn't read this file. Please try again."));
        return;
      }
      setResumeText(String(body.text ?? ""));
      setHiddenText(Array.isArray(body.hiddenText) ? body.hiddenText.map(String) : []);
      setConfirmed(false);
    } catch {
      setUploadError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  // US-IN-2: a job-description file fills the box with its text. On any rejection the box is left as it was.
  async function onJdFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setJdUploadError(null);
    setJdHiddenText([]);
    if (file.size > MAX_UPLOAD_BYTES) {
      setJdUploadError("This file is larger than 5 MB. Please upload a smaller file.");
      return;
    }
    setJdUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", "job_description");
      const res = await fetch("/api/extract", { method: "POST", body: form });
      const body = await readJson(res);
      if (!res.ok || !body) {
        setJdUploadError(errorFrom(res, body, "We couldn't read this file. Please try again."));
        return;
      }
      setJobDescription(String(body.text ?? ""));
      setJdHiddenText(Array.isArray(body.hiddenText) ? body.hiddenText.map(String) : []);
    } catch {
      setJdUploadError("Upload failed. Check your connection and try again.");
    } finally {
      setJdUploading(false);
    }
  }

  async function onAnalyze() {
    if (!canAnalyze || resumeText === null) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setReport(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText, jobDescription, confirmed: true }),
      });
      const body = await readJson(res);
      if (!res.ok || !body?.report) {
        setAnalyzeError(errorFrom(res, body, "The analysis failed. Please try again."));
        return;
      }
      setReport(body.report as Step1Report);
    } catch {
      setAnalyzeError("The analysis failed. Check your connection and try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Resume Keyword Check</h1>
        <p className={styles.lead}>
          Upload your resume and paste a job posting to see which keywords you&apos;re missing and which bullet points need work.
          Your files aren&apos;t stored.
        </p>
      </header>

      {demoMode && (
        <p className={styles.demo} role="note">
          Demo mode: simulated analysis. No AI is used until an API key is configured.
        </p>
      )}

      <section className={styles.card}>
        <h2>1. Upload your resume</h2>
        <label className={styles.label} htmlFor="resume-file">
          Resume file (PDF or DOCX, up to 5 MB)
        </label>
        <input
          id="resume-file"
          className={styles.file}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onFileChange}
          disabled={uploading}
        />
        {uploading && <p className={styles.status}>Reading your file…</p>}
        {uploadError && (
          <p className={styles.error} role="alert">
            {uploadError}
          </p>
        )}
      </section>

      {resumeText !== null && (
        <section className={styles.card}>
          <h2>2. Check the extracted text</h2>
          {hiddenText.length > 0 && (
            <div className={styles.warning} role="alert">
              <p>
                <strong>Hidden text was removed from your resume.</strong> It was invisible on the page (white, tiny or hidden), so it
                won&apos;t be analysed:
              </p>
              <ul>
                {hiddenText.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <label className={styles.label} htmlFor="resume-text">
            Extracted resume text
          </label>
          <p className={styles.hint}>Fix anything that came out wrong. Only this text is analysed.</p>
          <textarea
            id="resume-text"
            className={styles.textarea}
            rows={14}
            value={resumeText}
            onChange={(e) => {
              setResumeText(e.target.value);
              setConfirmed(false);
            }}
          />
          <label className={styles.checkbox}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I&apos;ve checked this text and it&apos;s correct
          </label>
        </section>
      )}

      <section className={styles.card}>
        <h2>3. Add the job description</h2>
        <label className={styles.label} htmlFor="job-description">
          Job description
        </label>
        <textarea
          id="job-description"
          className={styles.textarea}
          rows={10}
          maxLength={MAX_JD_CHARS}
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          placeholder="Paste the full job posting here"
        />
        <p className={styles.hint}>
          {jdLength.toLocaleString("en-US")} / {MAX_JD_CHARS.toLocaleString("en-US")} characters
          {jdLength < MIN_JD_CHARS && " (at least 300 characters needed)"}
        </p>
        <label className={styles.label} htmlFor="jd-file">
          Or upload the posting (PDF or DOCX, up to 5 MB)
        </label>
        <input
          id="jd-file"
          className={styles.file}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onJdFileChange}
          disabled={jdUploading}
        />
        {jdUploading && <p className={styles.status}>Reading the job description…</p>}
        {jdUploadError && (
          <p className={styles.error} role="alert">
            {jdUploadError}
          </p>
        )}
        {jdHiddenText.length > 0 && (
          <div className={styles.warning} role="alert">
            <p>
              <strong>Hidden text was removed from the job description.</strong> It was invisible on the page (white, tiny or
              hidden), so it won&apos;t be analysed:
            </p>
            <ul>
              {jdHiddenText.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={onAnalyze} disabled={!canAnalyze}>
          Analyze resume
        </button>
        {blockers.length > 0 && !analyzing && <p className={styles.hint}>To continue: {blockers.join(", ")}.</p>}
        {analyzing && (
          <p className={styles.status} role="status">
            Analyzing… this can take up to a minute.
          </p>
        )}
        {analyzeError && (
          <p className={styles.error} role="alert">
            {analyzeError}
          </p>
        )}
      </div>

      {report && <Report report={report} />}
    </main>
  );
}

function Report({ report }: { report: Step1Report }) {
  return (
    <section className={styles.card} aria-labelledby="report-heading">
      <h2 id="report-heading">{report.header}</h2>
      {report.mode === "demo" && <p className={styles.badge}>Simulated analysis (demo mode)</p>}

      <h3>Keywords from the job description</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Keyword</th>
              <th scope="col">Category</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.keywords.map((k) => (
              <tr key={k.keyword}>
                <td>{k.keyword}</td>
                <td>{k.category}</td>
                <td>
                  <span className={k.status === "missing" ? styles.missing : styles.under}>
                    {k.status === "missing" ? "Missing" : "Underrepresented"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.droppedKeywords.length > 0 && (
        <p className={styles.hint}>
          {report.droppedKeywords.length} suggested keyword{report.droppedKeywords.length === 1 ? " was" : "s were"} left out because{" "}
          {report.droppedKeywords.length === 1 ? "it doesn't" : "they don't"} appear in the job description.
        </p>
      )}

      <h3>Weakest bullet points</h3>
      {report.weakBullets.length === 0 ? (
        <p>No bullet points were found in your resume.</p>
      ) : (
        <ol className={styles.bullets}>
          {report.weakBullets.map((b, i) => (
            <li key={i}>
              <blockquote className={styles.quote}>{b.quote}</blockquote>
              <p>
                <strong>{REASON_LABELS[b.reason] ?? b.reason}:</strong> {b.explanation}
              </p>
            </li>
          ))}
        </ol>
      )}
      {report.bulletShortfall > 0 && (
        <p className={styles.hint}>
          Your resume has only {report.bulletsFound} bullet point{report.bulletsFound === 1 ? "" : "s"}, so this list is{" "}
          {report.bulletShortfall} short of the usual 3.
        </p>
      )}
    </section>
  );
}
