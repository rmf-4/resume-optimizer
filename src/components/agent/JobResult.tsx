"use client";

import type { DecideResult } from "@/lib/agent/run";
import type { TailorResult } from "@/lib/agent/tailor";
import base from "../Analyzer.module.css";
import styles from "../AgentRunner.module.css";
import { ExportPanel, highlightNew, reasonsText } from "./shared";

export type Decide = Omit<DecideResult, "context">;
export type RunResult = { mode: "ai" | "simulated"; decide: Decide; tailor: TailorResult | null; tailorError?: { code: string; message: string } };

export const DECISION: Record<Decide["decision"], { label: string; className: string }> = {
  apply: { label: "Apply", className: styles.apply },
  skip: { label: "Skip", className: styles.skip },
  needs_human: { label: "Needs a human", className: styles.human },
};

const KIND: Record<string, string> = { skill: "Skill or experience", credential: "Credential", person: "Only you can answer" };

/** One job's decision, and its tailored resume when there is one. */
export function JobResult(props: {
  title: string;
  result: RunResult;
  resumeText: string;
  notes: string;
  posting: string;
  running: boolean;
  onPrepareAnyway: () => void;
  fileStem: string;
}) {
  const d = props.result.decide;
  const t = props.result.tailor;
  return (
    <>
      <section className={base.card} aria-live="polite">
        <h2>{props.title}</h2>
        <p className={`${styles.decision} ${DECISION[d.decision].className}`}>{DECISION[d.decision].label}</p>
        <ul className={styles.reasons}>
          {d.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p className={base.hint}>
          Evidence coverage counts requirements with a quote from your resume or notes. It isn&apos;t an ATS score or a chance of getting the job.
        </p>

        {d.warnings.length > 0 && (
          <div className={base.warning} role="alert">
            <ul>
              {d.warnings.map((w, i) => (
                <li key={i}>
                  {w.kind.replace("_", " ")} in the {w.input}: &ldquo;{w.quote}&rdquo;
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className={styles.facts}>
          <summary>Requirements and your evidence ({d.requirements.length})</summary>
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
                        <span className={base.hint}>Your call</span>
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
        </details>

        {d.gaps.length > 0 && (
          <>
            <h3>Gaps</h3>
            <p className={base.hint}>The agent won&apos;t claim these. If one is true, add it to your notes and check this job again.</p>
            <ul className={styles.reasons}>
              {d.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </>
        )}

        {d.personOnly.length > 0 && (
          <>
            <h3>Only you can answer</h3>
            <ul className={styles.reasons}>
              {d.personOnly.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </>
        )}

        {!t && d.decision !== "apply" && (
          <div className={styles.row}>
            <button type="button" className={styles.secondary} disabled={props.running} onClick={props.onPrepareAnyway}>
              {props.running ? "Tailoring…" : "Prepare anyway"}
            </button>
            <span className={base.hint}>Tailors your resume even though the agent didn&apos;t mark this apply.</span>
          </div>
        )}
        {props.result.tailorError && (
          <p className={base.error} role="alert">
            {props.result.tailorError.message}
          </p>
        )}
      </section>

      {t && (
        <section className={base.card}>
          <h2>Your resume for this job</h2>
          {t.preparedAnyway && <p className={base.badge}>Prepared anyway</p>}
          {t.angle && (
            <>
              <h3>The angle</h3>
              <p className={styles.angle}>{t.angle}</p>
              <p className={base.hint}>What the changes aim to show. It isn&apos;t added to the resume.</p>
            </>
          )}

          {t.echo.total > 0 && (
            <p>
              Of the {t.echo.total} requirements you meet, your resume now states{" "}
              <strong>
                {t.echo.before} before → {t.echo.after} after
              </strong>{" "}
              in the posting&apos;s own words. <span className={base.hint}>(Not an ATS score.)</span>
            </p>
          )}

          <h3>Rewrites ({t.kept.length})</h3>
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
                      {i > 0 && "; "}&ldquo;{r.text}&rdquo; (from &ldquo;{r.requirement}&rdquo;)
                    </span>
                  ))}
                </p>
              )}
            </div>
          ))}

          {t.moved.length > 0 && (
            <>
              <h3>Moved to the top ({t.moved.length})</h3>
              <ul className={styles.reasons}>
                {t.moved.map((m) => (
                  <li key={m.bulletId}>{m.text}</li>
                ))}
              </ul>
            </>
          )}

          {t.skillsReordered.length > 0 && (
            <>
              <h3>Skills in this job&apos;s order</h3>
              {t.skillsReordered.map((r) => (
                <div key={r.lineId} className={styles.pair}>
                  <p className={styles.before}>{r.before}</p>
                  <p className={styles.after}>{r.after}</p>
                </div>
              ))}
            </>
          )}

          {t.reverted.length > 0 && (
            <details className={styles.facts}>
              <summary>Rewrites thrown out ({t.reverted.length})</summary>
              {t.reverted.map((r) => (
                <div key={r.bulletId} className={styles.pair}>
                  <p className={styles.after}>{r.rewrite}</p>
                  <p className={styles.why}>{reasonsText(r.reasons)}</p>
                </div>
              ))}
            </details>
          )}

          {t.questions.length > 0 && (
            <>
              <h3>Questions for this job</h3>
              <p className={base.hint}>True answers would make this version stronger. Add them to your notes and check the job again.</p>
              <ol className={styles.reasons}>
                {t.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </>
          )}

          <h3>Full resume</h3>
          <pre className={styles.preview}>{t.tailored}</pre>
          <ExportPanel text={t.tailored} resumeText={props.resumeText} notes={props.notes} posting={props.posting} fileStem={props.fileStem} />
        </section>
      )}
    </>
  );
}
