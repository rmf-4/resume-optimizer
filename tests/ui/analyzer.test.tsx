// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Analyzer from "@/components/Analyzer";
import { JOB_DESCRIPTION, RESUME_TEXT } from "../helpers/fixtures";

const XSS = '<img src=x onerror="window.__pwned=1">';

const REPORT = {
  header: "Step 1: ATS & Keyword Gap Analysis",
  mode: "ai",
  keywords: [
    { keyword: "Tableau", category: "tool", status: "missing" },
    { keyword: "Excel", category: "tool", status: "underrepresented" },
  ],
  droppedKeywords: [],
  weakBullets: [{ quote: `Responsible for reports ${XSS}`, reason: "passive phrasing", explanation: "Describes a duty." }],
  bulletsFound: 1,
  bulletShortfall: 2,
};

function mockFetch(extractBody: object, analyzeBody: object = { report: REPORT }, analyzeStatus = 200) {
  const fn = vi.fn(async (url: string) => {
    if (url === "/api/extract") return new Response(JSON.stringify(extractBody), { status: "error" in extractBody ? 422 : 200 });
    return new Response(JSON.stringify(analyzeBody), { status: analyzeStatus });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function uploadFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText(/resume file/i);
  await user.upload(input, new File(["%PDF-1.7"], "resume.pdf", { type: "application/pdf" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Analyzer page", () => {
  it("test_generation_requires_confirmed_extracted_text", async () => {
    const fetchMock = mockFetch({ fileType: "pdf", text: RESUME_TEXT, hiddenText: [], pageCount: 1 });
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);

    const button = screen.getByRole("button", { name: /analyze resume/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await uploadFile(user);
    const textArea = await screen.findByLabelText(/extracted resume text/i);
    expect((textArea as HTMLTextAreaElement).value).toBe(RESUME_TEXT);

    const jd = screen.getByLabelText(/^job description/i);
    await user.click(jd);
    await user.paste(JOB_DESCRIPTION);
    expect((button as HTMLButtonElement).disabled).toBe(true); // text not yet confirmed

    const confirm = screen.getByLabelText(/i've checked this text/i);
    await user.click(confirm);
    expect((button as HTMLButtonElement).disabled).toBe(false);

    // Editing after confirming requires confirming again; edits are kept.
    await user.type(textArea, "\nNew line");
    expect((confirm as HTMLInputElement).checked).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((textArea as HTMLTextAreaElement).value).toContain("New line");

    await user.click(confirm);
    await user.click(button);
    await screen.findByRole("heading", { name: "Step 1: ATS & Keyword Gap Analysis" });

    const analyzeCall = fetchMock.mock.calls.find((c) => c[0] === "/api/analyze") as unknown as [string, RequestInit];
    const sent = JSON.parse(String(analyzeCall[1].body));
    expect(sent.confirmed).toBe(true);
    expect(sent.resumeText).toContain("New line");
  });

  it("test_jd_under_300_chars_disables_button_with_reason", async () => {
    mockFetch({ fileType: "pdf", text: RESUME_TEXT, hiddenText: [], pageCount: 1 });
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await uploadFile(user);
    await user.click(await screen.findByLabelText(/i've checked this text/i));
    await user.click(screen.getByLabelText(/^job description/i));
    await user.paste("Too short");
    expect((screen.getByRole("button", { name: /analyze resume/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/at least 300 characters/i)).toBeTruthy();
  });

  it("test_hidden_text_warning_shown_in_ui", async () => {
    mockFetch({ fileType: "docx", text: RESUME_TEXT, hiddenText: ["WHITE-TEXT Tableau SQL"], pageCount: null });
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await uploadFile(user);
    expect(await screen.findByText(/hidden text was removed/i)).toBeTruthy();
    expect(screen.getByText("WHITE-TEXT Tableau SQL")).toBeTruthy();
  });

  it("test_upload_error_message_shown", async () => {
    mockFetch({ error: { code: "scanned_pdf", message: "This looks like a scanned image; upload a text-based PDF or DOCX" } });
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await uploadFile(user);
    expect(await screen.findByText("This looks like a scanned image; upload a text-based PDF or DOCX")).toBeTruthy();
  });

  it("test_report_renders_as_plain_text_xss_payloads_inert", async () => {
    mockFetch({ fileType: "pdf", text: RESUME_TEXT, hiddenText: [], pageCount: 1 });
    const user = userEvent.setup();
    const { container } = render(<Analyzer demoMode={false} />);
    await uploadFile(user);
    await user.click(await screen.findByLabelText(/i've checked this text/i));
    await user.click(screen.getByLabelText(/^job description/i));
    await user.paste(JOB_DESCRIPTION);
    await user.click(screen.getByRole("button", { name: /analyze resume/i }));
    await screen.findByRole("heading", { name: "Step 1: ATS & Keyword Gap Analysis" });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(`Responsible for reports ${XSS}`, { exact: false })).toBeTruthy();
    expect(screen.getByText(/only 1 bullet/i)).toBeTruthy(); // REQ-GEN-06 shortfall stated
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("test_demo_mode_banner_shown", async () => {
    mockFetch({});
    render(<Analyzer demoMode={true} />);
    expect(screen.getByText(/demo mode/i)).toBeTruthy();
  });

  it("test_analyze_error_shown", async () => {
    mockFetch({ fileType: "pdf", text: RESUME_TEXT, hiddenText: [], pageCount: 1 }, { error: { code: "refused", message: "The AI declined: not allowed." } }, 422);
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await uploadFile(user);
    await user.click(await screen.findByLabelText(/i've checked this text/i));
    await user.click(screen.getByLabelText(/^job description/i));
    await user.paste(JOB_DESCRIPTION);
    await user.click(screen.getByRole("button", { name: /analyze resume/i }));
    await waitFor(() => expect(screen.getByText("The AI declined: not allowed.")).toBeTruthy());
  });
});
