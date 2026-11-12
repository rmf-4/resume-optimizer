// A prompt the user copies into their own AI assistant (ChatGPT, Claude, Gemini...) to pull the projects and
// work it remembers into the notes box (REQ-AG-45). Assistants misremember, so the prompt asks for marked
// uncertainty, and code drops anything marked before the agent sees it.

export const UNSURE_MARK = "[unsure]";
export const CONFIRM_HEADING = "THINGS TO CONFIRM";

export const FACTS_PROMPT = `I'm updating my resume. From what you know about me (our past conversations and anything you remember about me), list every project, job, internship, leadership role, class project, competition and accomplishment I've told you about.

Rules:
- Only include things I actually told you about or that you saw me work on. Don't guess, generalise or fill gaps.
- Keep my numbers, dates, names, tools and results exactly as I gave them. Don't round, estimate or invent any.
- Don't describe my qualities (no "hardworking", "passionate", "strong leader"). Just say what I did.
- If you're not sure about a detail, put ${UNSURE_MARK} at the start of that line.

Write each item like this, in plain text with no tables:
PROJECT: <name> (<dates, if I told you>)
ROLE: <what I was>
WHAT I DID: <1 to 3 specific sentences about my own actions>
TOOLS AND SKILLS: <only ones I actually used>
RESULTS: <numbers or outcomes I told you, or "none stated">

After the list, add a section headed ${CONFIRM_HEADING} with anything you're unsure about or that I should double-check.

Keep the whole answer under 9,000 characters.`;

/**
 * The notes the agent may treat as facts: every line marked ${UNSURE_MARK} and everything from a
 * "${CONFIRM_HEADING}" heading onwards is dropped.
 */
export function trustedNotes(notes: string): string {
  const lines = notes.split(/\r?\n/);
  const cut = lines.findIndex((l) => l.replace(/[^A-Za-z ]/g, "").trim().toUpperCase() === CONFIRM_HEADING);
  return (cut === -1 ? lines : lines.slice(0, cut))
    .filter((l) => !l.toLowerCase().includes(UNSURE_MARK))
    .join("\n")
    .trim();
}

/** Turns answered interview questions into notes text: the client's own words, which then count as facts. */
export function answersToNotes(qa: { question: string; answer: string }[]): string {
  const answered = qa.filter((x) => x.answer.trim());
  if (answered.length === 0) return "";
  return ["Interview answers (from the client):", ...answered.map((x) => `Q: ${x.question.trim()}\nA: ${x.answer.trim()}`)].join("\n");
}
