"use client";

import { useState, type ReactNode } from "react";
import type { RevertType } from "@/lib/agent/tailor";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";
import base from "../Analyzer.module.css";
import styles from "../AgentRunner.module.css";

export async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function messageFrom(res: Response, body: Record<string, unknown> | null, fallback: string): string {
  const err = body?.error as { message?: string } | undefined;
  if (err?.message) return err.message;
  if (res.status === 413) return "This file is too large to upload. Please use a file under 4.5 MB.";
  return fallback;
}

/** POSTs JSON and returns the parsed body, or an error message. */
export async function postJson<T>(path: string, payload: unknown, fallback: string): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await readJson(res);
    if (!res.ok || !body) return { ok: false, message: messageFrom(res, body, fallback) };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, message: `${fallback} Check your connection and try again.` };
  }
}

export async function uploadFile(file: File, purpose?: string): Promise<{ text: string; hiddenText: string[] } | string> {
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

export const REVERT: Record<RevertType, string> = {
  new_number: "adds a number the facts don't have",
  new_date: "adds a date the facts don't have",
  new_name: "adds a name the facts don't have",
  new_contact: "adds contact details",
  new_skill: "claims something from the posting the facts don't show",
  scope_change: "makes the role sound bigger",
  self_praise: "praises instead of stating what was done",
  first_person: "is written in the first person",
  hidden_text: "contains hidden text",
  banned_opening: "starts with a weak opening",
  placeholder: "contains a placeholder",
  too_long: "is too long",
  keyword_overuse: "repeats a keyword too often",
  assembled_check: "failed the whole-resume check",
};

export function reasonsText(reasons: { type: RevertType; text: string }[]): ReactNode {
  return reasons.map((x, i) => (
    <span key={i}>
      {i > 0 && "; "}
      {REVERT[x.type]}: &ldquo;{x.text}&rdquo;
    </span>
  ));
}

/** Words in the new text that aren't in the old one are highlighted (REQ-AG-25). */
export function highlightNew(original: string, rewrite: string): ReactNode[] {
  const known = new Set(original.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return rewrite.split(/(\s+)/).map((part, i) => {
    const words = part.toLowerCase().match(/[a-z0-9]+/g);
    return words && words.some((w) => !known.has(w)) ? <mark key={i}>{part}</mark> : part;
  });
}

type TemplateChoice = "classic" | "modern" | "compact";
const TEMPLATE_CHOICES: { id: TemplateChoice; label: string; description: string }[] = [
  { id: "classic", label: "Classic", description: "Serif, centred name, ruled capital headings. The traditional business resume." },
  { id: "modern", label: "Modern", description: "Clean sans serif with navy headings and roles in italics." },
  { id: "compact", label: "Compact", description: "Small, tight sans serif for a full page of experience." },
];

/**
 * Template choice and downloads. The server re-checks `text` against the resume and notes before building the
 * file (REQ-AG-43), so those go along with it.
 */
export function ExportPanel(props: { text: string; resumeText: string; notes: string; posting?: string; fileStem: string }) {
  const [template, setTemplate] = useState<TemplateChoice>("classic");
  const [busy, setBusy] = useState<"pdf" | "docx" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const name = `${props.fileStem}-${template}`;

  async function download(format: "pdf" | "docx") {
    setBusy(format);
    setError(null);
    try {
      const res = await fetch("/api/agent/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText: props.resumeText, notes: props.notes, posting: props.posting ?? "", tailored: props.text, format, template }),
      });
      if (!res.ok) return setError(messageFrom(res, await readJson(res), "The download failed. Please try again."));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("The download failed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copying isn't allowed in this browser. Select the text and copy it instead.");
    }
  }

  return (
    <>
      <fieldset className={styles.templates}>
        <legend className={base.label}>Template</legend>
        {TEMPLATE_CHOICES.map((c) => (
          <label key={c.id} className={`${styles.template} ${template === c.id ? styles.templateOn : ""}`}>
            <input type="radio" name={`template-${props.fileStem}`} value={c.id} checked={template === c.id} onChange={() => setTemplate(c.id)} />
            <span>
              <strong>{c.label}</strong>
              <span className={base.hint}>{c.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className={base.hint}>Every template fits the resume on one page when it can, by tightening spacing and type down to 9 pt.</p>
      <div className={styles.row}>
        <button type="button" className={base.button} disabled={busy !== null} onClick={() => download("pdf")}>
          {busy === "pdf" ? "Preparing…" : "Download PDF"}
        </button>
        <button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => download("docx")}>
          {busy === "docx" ? "Preparing…" : "Download DOCX"}
        </button>
        <button type="button" className={styles.secondary} onClick={copy}>
          {copied ? "Copied" : "Copy text"}
        </button>
      </div>
      {error && (
        <p className={base.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
