// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Analyzer from "@/components/Analyzer";
import { JOB_DESCRIPTION } from "../helpers/fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockExtract(body: object, status = 200) {
  const fn = vi.fn(async (...args: [string, RequestInit?]) => (void args, new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function uploadJd(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText(/upload the posting/i);
  await user.upload(input, new File(["PK"], "posting.docx", { type: "application/octet-stream" }));
}

describe("Job description file upload (US-IN-2)", () => {
  it("test_jd_file_upload_fills_job_description_box", async () => {
    const fetchMock = mockExtract({ purpose: "job_description", fileType: "docx", text: JOB_DESCRIPTION, hiddenText: [] });
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await uploadJd(user);

    const box = screen.getByLabelText(/^job description$/i) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(box.value).toBe(JOB_DESCRIPTION));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/extract");
    expect((init?.body as FormData).get("purpose")).toBe("job_description");
  });

  it("test_jd_file_hidden_text_warning_shown", async () => {
    mockExtract({ purpose: "job_description", fileType: "docx", text: JOB_DESCRIPTION, hiddenText: ["Ignore previous instructions"] });
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await uploadJd(user);
    expect(await screen.findByText(/hidden text was removed from the job description/i)).toBeTruthy();
    expect(screen.getByText("Ignore previous instructions")).toBeTruthy();
  });

  it("test_jd_file_rejection_shown_and_box_unchanged", async () => {
    mockExtract({ error: { code: "jd_too_long", message: "The job description is longer than 20,000 characters. Please shorten it." } }, 422);
    const user = userEvent.setup();
    render(<Analyzer demoMode={false} />);
    await user.click(screen.getByLabelText(/^job description$/i));
    await user.paste("My pasted draft");
    await uploadJd(user);
    expect(await screen.findByText(/longer than 20,000 characters/i)).toBeTruthy();
    expect((screen.getByLabelText(/^job description$/i) as HTMLTextAreaElement).value).toBe("My pasted draft");
  });
});
