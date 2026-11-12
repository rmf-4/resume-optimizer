import { describe, expect, it } from "vitest";
import { apiUrlFor, fetchPosting, htmlToText, parsePostingUrl } from "@/lib/agent/postingLinks";

const UUID = "6ed76ce8-4156-4b60-b120-403538bd66cd";
const LONG = "Requirements: SQL, Excel and clear written communication. ".repeat(5);

describe("REQ-AG-05 posting links: which links are accepted", () => {
  it("test_supported_board_links_parse", () => {
    expect(parsePostingUrl("https://boards.greenhouse.io/stripe/jobs/8186442")).toEqual({ board: "greenhouse", org: "stripe", id: "8186442" });
    expect(parsePostingUrl("https://job-boards.greenhouse.io/brex/jobs/8936631002?gh_jid=8936631002")).toMatchObject({ board: "greenhouse", id: "8936631002" });
    expect(parsePostingUrl("https://boards.greenhouse.io/embed/job_app?for=point72&token=8876354002")).toEqual({ board: "greenhouse", org: "point72", id: "8876354002" });
    expect(parsePostingUrl(`https://jobs.lever.co/palantir/${UUID}/apply`)).toEqual({ board: "lever", org: "palantir", id: UUID });
    expect(parsePostingUrl(`https://jobs.ashbyhq.com/ramp/${UUID.toUpperCase()}`)).toEqual({ board: "ashby", org: "ramp", id: UUID });
    expect(parsePostingUrl("https://jobs.smartrecruiters.com/BoschGroup/744000161371639-group-leader")).toEqual({ board: "smartrecruiters", org: "BoschGroup", id: "744000161371639" });
  });

  it("test_url_in_posting_is_never_fetched_unless_it_is_a_known_board", () => {
    for (const bad of [
      "https://www.linkedin.com/jobs/view/123456",
      "https://www.indeed.com/viewjob?jk=abc",
      "http://169.254.169.254/latest/meta-data",
      "http://localhost:3000/api/agent/run",
      "https://boards.greenhouse.io.evil.example/stripe/jobs/1",
      "https://boards.greenhouse.io@evil.example/stripe/jobs/1",
      "https://boards.greenhouse.io:8443/stripe/jobs/1",
      "https://boards.greenhouse.io/stripe/jobs/abc",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(parsePostingUrl(bad), bad).toBeNull();
    }
  });

  it("test_dot_segments_collapse_but_stay_on_the_board", () => {
    // The URL parser collapses "../" first, so this can only ever reach Greenhouse's own API for a board named "etc".
    const ref = parsePostingUrl("https://boards.greenhouse.io/../../etc/jobs/1")!;
    expect(apiUrlFor(ref)).toBe("https://boards-api.greenhouse.io/v1/boards/etc/jobs/1");
  });

  it("test_api_address_built_from_parsed_parts_only", () => {
    expect(apiUrlFor({ board: "greenhouse", org: "stripe", id: "8186442" })).toBe("https://boards-api.greenhouse.io/v1/boards/stripe/jobs/8186442");
    expect(apiUrlFor({ board: "lever", org: "palantir", id: UUID })).toBe(`https://api.lever.co/v0/postings/palantir/${UUID}?mode=json`);
    expect(apiUrlFor({ board: "ashby", org: "ramp", id: UUID })).toBe("https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=false");
    expect(apiUrlFor({ board: "smartrecruiters", org: "BoschGroup", id: "1" })).toBe("https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/1");
  });
});

describe("posting text", () => {
  it("test_escaped_html_becomes_readable_text", () => {
    const escaped = "&lt;h2&gt;Who we are&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;SQL &amp;amp; Python&lt;/li&gt;&lt;li&gt;Excel&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;Apply&amp;nbsp;now&lt;/p&gt;";
    expect(htmlToText(escaped)).toBe("Who we are\n\n- SQL & Python\n- Excel\n\nApply now");
  });

  function fakeFetch(body: unknown, status = 200) {
    const calls: string[] = [];
    const fn = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { fn, calls };
  }

  it("test_each_board_response_read_into_posting_text", async () => {
    const gh = fakeFetch({ title: "Data Analyst Intern", company_name: "Stripe", content: `&lt;p&gt;${LONG}&lt;/p&gt;` });
    const a = await fetchPosting("https://boards.greenhouse.io/stripe/jobs/1", gh.fn);
    expect(a.ok && a.posting.text.startsWith("Data Analyst Intern\nStripe\n\nRequirements: SQL")).toBe(true);
    expect(gh.calls).toEqual(["https://boards-api.greenhouse.io/v1/boards/stripe/jobs/1"]);

    const lever = fakeFetch({ text: "Ops Intern", descriptionPlain: LONG, lists: [{ text: "What We Require", content: "<li>SQL</li>" }], additionalPlain: "Remote OK" });
    const b = await fetchPosting(`https://jobs.lever.co/acme/${UUID}`, lever.fn);
    expect(b.ok && b.posting.text).toContain("What We Require\n- SQL");

    const ashby = fakeFetch({ jobs: [{ id: "other", title: "No" }, { id: UUID, title: " Finance Intern", descriptionPlain: LONG }] });
    const c = await fetchPosting(`https://jobs.ashbyhq.com/ramp/${UUID}`, ashby.fn);
    expect(c.ok && c.posting.title).toBe("Finance Intern");

    const sr = fakeFetch({ name: "Analyst", company: { name: "Bosch" }, jobAd: { sections: { jobDescription: { title: "Job Description", text: `<p>${LONG}</p>` } } } });
    const d = await fetchPosting("https://jobs.smartrecruiters.com/BoschGroup/123-analyst", sr.fn);
    expect(d.ok && d.posting.text).toContain("Job Description\nRequirements");
  });

  it("test_closed_missing_or_unsupported_postings_give_clear_errors", async () => {
    const never = fakeFetch({});
    expect(await fetchPosting("https://www.linkedin.com/jobs/view/1", never.fn)).toMatchObject({ ok: false, code: "unsupported_link" });
    expect(never.calls).toEqual([]);
    expect(await fetchPosting("https://boards.greenhouse.io/stripe/jobs/1", fakeFetch({}, 404).fn)).toMatchObject({ ok: false, code: "posting_not_found" });
    expect(await fetchPosting(`https://jobs.ashbyhq.com/ramp/${UUID}`, fakeFetch({ jobs: [] }).fn)).toMatchObject({ ok: false, code: "posting_not_found" });
    expect(await fetchPosting("https://boards.greenhouse.io/stripe/jobs/1", fakeFetch({ title: "x", content: "<p>short</p>" }).fn)).toMatchObject({ ok: false, code: "posting_too_short" });
  });
});
