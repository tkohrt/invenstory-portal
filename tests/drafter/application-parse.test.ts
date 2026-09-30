// Phase 2: bringing in a funder's application.
//
// Real PDF and Word files are built from the sample applications and read back
// through the same extraction the portal uses, so these tests exercise unpdf and
// mammoth, not a stand-in. What the model would return is simulated per window
// from the expected questions, including the ways models actually go wrong: a
// question cut at a window edge, numbering kept or dropped, a paraphrase, a
// limit the source never states, a limit it states but the model missed.
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { SAMPLES, type SampleApplication } from "../fixtures/applications";
import {
  applicationWindows, parseWindowAnswer, mergeWindows, promptInSource, statedLimits,
  stripNumbering, sameQuestion, resolveLimit, isoDeadline, parseMatches, bankFor,
  type WindowAnswer, type BankQuestion,
} from "@/lib/application-parse";
import {
  pdfToText, docxToText, htmlToText, looksLikeLoginWall, fetchableUrl, uploadKind, tidyText,
} from "@/lib/application-text";

// ---------------------------------------------------------------------------
// Building real files.
// ---------------------------------------------------------------------------

async function makePdf(text: string): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "LETTER", margin: 64 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>(res => doc.on("end", () => res()));
  doc.font("Helvetica").fontSize(10.5);
  for (const para of text.split(/\n\n/)) doc.text(para, { paragraphGap: 6 });
  doc.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function makeDocx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const paras = text.split("\n").map(l => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function sourceOf(s: SampleApplication): Promise<string> {
  if (s.format === "pdf") return pdfToText(await makePdf(s.text));
  if (s.format === "docx") return docxToText(await makeDocx(s.text));
  return tidyText(s.text);
}

/** What a well-behaved model returns for each window: every expected question it can see. */
function simulateModel(s: SampleApplication, source: string, windows: string[]): WindowAnswer[] {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ");
  return windows.map((w, wi) => {
    const nw = norm(w);
    const questions = s.expected.flatMap(q => {
      const nq = norm(q.prompt);
      if (nw.includes(nq)) {
        return [{ prompt: q.prompt, guidance: null, criteria: null, limit_value: q.limit?.value ?? null, limit_unit: q.limit?.unit ?? null }];
      }
      // Cut at the window's end: the model sees and returns the first part.
      const head = nq.slice(0, 40);
      if (nw.endsWith(nq.slice(0, 30)) || (nw.includes(head) && !nw.includes(nq))) {
        return [{ prompt: q.prompt.slice(0, 45), guidance: null, criteria: null, limit_value: null, limit_unit: null }];
      }
      return [];
    });
    return {
      title: wi === 0 ? s.title : null, funder: wi === 0 ? s.funder : null, deadline: null,
      attachments: wi === windows.length - 1 ? s.attachments : [], questions, invalid: 0,
    };
  });
}

// ---------------------------------------------------------------------------

describe("the three sample applications, end to end through real files", () => {
  for (const s of SAMPLES) {
    it(`${s.key} (${s.format}): every expected question and limit survives extraction and parsing`, async () => {
      const source = await sourceOf(s);
      for (const q of s.expected) expect(promptInSource(q.prompt, source), q.prompt).toBe(true);

      const { windows, truncated } = applicationWindows(source);
      expect(truncated).toBe(false);
      const result = mergeWindows(simulateModel(s, source, windows), source);

      expect(result.sections.map(x => x.prompt)).toEqual(s.expected.map(q => q.prompt));
      expect(result.sections.map(x => x.limit_value)).toEqual(s.expected.map(q => q.limit?.value ?? null));
      expect(result.sections.map(x => x.limit_unit)).toEqual(s.expected.map(q => q.limit?.unit ?? null));
      expect(result.sections.every(x => x.in_source)).toBe(true);
      expect(result.funder).toBe(s.funder);
    });
  }

  it("the RFP is long enough to need several windows, and questions cut at an edge are merged, not doubled", async () => {
    const s = SAMPLES.find(x => x.key === "rfp")!;
    const source = await sourceOf(s);
    const { windows } = applicationWindows(source);
    expect(windows.length).toBeGreaterThan(1);
    const answers = simulateModel(s, source, windows);
    const proposed = answers.reduce((n, a) => n + a.questions.length, 0);
    const result = mergeWindows(answers, source);
    expect(result.sections).toHaveLength(s.expected.length);
    expect(result.stats.duplicates).toBe(proposed - s.expected.length);
  });

  it("the RFP's page limit stays out of the limit fields", async () => {
    const s = SAMPLES.find(x => x.key === "rfp")!;
    const source = await sourceOf(s);
    expect(statedLimits(source).some(l => l.value === 3 )).toBe(false);
  });
});

describe("what the code refuses to take on trust", () => {
  const source = tidyText(SAMPLES[0].text);

  it("flags a paraphrased question instead of passing it off as the funder's words", () => {
    const r = mergeWindows([{
      title: null, funder: null, deadline: null, attachments: [], invalid: 0,
      questions: [{ prompt: "Tell us about the mission and background of your group.", guidance: null, criteria: null, limit_value: 150, limit_unit: "words" }],
    }], source);
    expect(r.sections[0].in_source).toBe(false);
    expect(r.stats.notInSource).toBe(1);
  });

  it("removes a limit the funder never stated, and fills one the model missed", () => {
    const invented = resolveLimit({ prompt: "Briefly describe your organization's mission and history.", guidance: null, criteria: null, limit_value: 500, limit_unit: "words" }, source);
    expect(invented).toEqual({ limit: null, changed: "removed" });
    const missed = resolveLimit({ prompt: "Briefly describe your organization's mission and history. (150 words maximum)", guidance: null, criteria: null, limit_value: null, limit_unit: null }, source);
    expect(missed).toEqual({ limit: { value: 150, unit: "words" }, changed: "filled" });
  });

  it("keeps numbering out of the prompt but still finds the question in the source", () => {
    expect(stripNumbering("4.B.1 Using local data, describe")).toBe("Using local data, describe");
    expect(stripNumbering("Question 3: Describe the need")).toBe("Describe the need");
    expect(stripNumbering("(a) Who else is funding this work?")).toBe("Who else is funding this work?");
    expect(stripNumbering("Part of your budget")).toBe("Part of your budget");
    expect(stripNumbering("U.S. residents only?")).toBe("U.S. residents only?");
    expect(stripNumbering("A.2 Describe staff")).toBe("Describe staff");
    expect(promptInSource("3. Describe the need this project addresses.", source)).toBe(true);
  });

  it("does not merge two different questions that share words", () => {
    expect(sameQuestion("What experience does your organization have running field trips?",
      "How will you continue this work after the grant period ends?")).toBe(false);
    expect(sameQuestion("Describe the need this project addresses.",
      "3. Describe the need this project addresses. Why do the students you serve not reach outdoor learning today?")).toBe(true);
  });

  it("reads limits written every way funders write them", () => {
    expect(statedLimits("(2,500 characters including spaces) a 250-word summary, max 300 words, 1000 chars"))
      .toEqual([
        { value: 2500, unit: "characters" }, { value: 250, unit: "words" },
        { value: 300, unit: "words" }, { value: 1000, unit: "characters" },
      ]);
  });

  it("parses a messy model answer and counts what it could not use", () => {
    const raw = "Here is the JSON:\n```json\n" + JSON.stringify({
      title: "X", funder: null, deadline: "February 27, 2027",
      attachments: ["Budget", null],
      questions: [
        { prompt: "Describe the project.", limit_value: "400", limit_unit: "Words" },
        { prompt: "" },
        { nope: true },
      ],
    }) + "\n```";
    const a = parseWindowAnswer(raw)!;
    expect(a.questions).toHaveLength(1);
    expect(a.questions[0]).toMatchObject({ limit_value: 400, limit_unit: "words" });
    expect(a.invalid).toBe(2);
    expect(a.attachments).toEqual(["Budget"]);
    expect(parseWindowAnswer("I could not find any questions.")).toBeNull();
  });

  it("turns written deadlines into dates without guessing a year", () => {
    expect(isoDeadline("Applications due: February 27, 2027, 4:00 p.m.")).toBe("2027-02-27");
    expect(isoDeadline("Deadline: March 15, 2027 at 5:00 p.m.")).toBe("2027-03-15");
    expect(isoDeadline("3/5/2027")).toBe("2027-03-05");
    expect(isoDeadline("mid-March")).toBeNull();
  });
});

describe("matching to the question bank", () => {
  const bank: BankQuestion[] = [
    { id: "1", slug: "need", category: "Statement of need", prompt_text: "", audience: "nonprofit" },
    { id: "2", slug: "program", category: "Program description", prompt_text: "", audience: "nonprofit" },
    { id: "3", slug: "traction", category: "Traction", prompt_text: "", audience: "startup" },
    { id: "4", slug: "leadership", category: "Leadership", prompt_text: "", audience: "both", wanted_kinds: ["leadership_team"] },
  ];

  it("offers only the bank questions for this client's org type", () => {
    expect(bankFor(bank, "nonprofit").map(q => q.slug)).toEqual(["need", "program", "leadership"]);
    expect(bankFor(bank, "for_profit").map(q => q.slug)).toEqual(["traction", "leadership"]);
  });

  it("keeps real slugs and kinds, drops invented ones, and adds each slug's default kinds", () => {
    const raw = JSON.stringify([
      { i: 0, primary: "need", slugs: ["need", "made-up"], kinds: ["need_story", "invented_kind"], reason: "Asks for the problem." },
      { i: 1, primary: "NEW TOPIC", slugs: ["program"], kinds: [], reason: "Asks about transport logistics." },
      { i: 2, primary: "traction", slugs: [], kinds: ["traction"], reason: "x" },
      { i: 9, primary: "need" },
    ]);
    const m = parseMatches(raw, 4, bank, "nonprofit");
    expect(m[0].primary).toBe("need");
    expect(m[0].slugs).toEqual(["need"]);
    expect(m[0].kinds).toEqual(expect.arrayContaining(["need_story", "need_data", "population_geography"]));
    expect(m[0].kinds).not.toContain("invented_kind");
    expect(m[1].primary).toBeNull();
    expect(m[1].slugs).toEqual(["program"]);
    expect(m[1].kinds).toContain("program_model");
    // A startup slug for a nonprofit client is not a match.
    expect(m[2].primary).toBeNull();
    expect(m[2].kinds).not.toContain("traction");
    // Never returned: a new topic that says so.
    expect(m[3]).toMatchObject({ primary: null, slugs: [], kinds: [] });
    expect(m[3].reason).toMatch(/did not return/);
  });

  it("uses a bank row's own wanted_kinds when it has them", () => {
    const m = parseMatches(JSON.stringify([{ i: 0, primary: "leadership" }]), 1, bank, "nonprofit");
    expect(m[0].kinds).toEqual(["leadership_team"]);
  });

  it("returns every section unmatched when the model's answer is not JSON", () => {
    expect(parseMatches("sorry", 2, bank, "nonprofit").every(x => x.primary === null)).toBe(true);
  });
});

describe("reading a web page", () => {
  it("keeps the questions and drops the scaffolding", () => {
    const html = `<html><head><style>p{}</style><script>var x=1</script></head><body>
      <nav>Home | About</nav><h1>Apply</h1><p>1. Describe the need&nbsp;this project addresses. (300 words maximum)</p>
      <ul><li>Budget</li><li>IRS letter &amp; audit</li></ul><footer>© Fund</footer></body></html>`;
    const t = htmlToText(html);
    expect(t).toContain("Describe the need this project addresses. (300 words maximum)");
    expect(t).toContain("IRS letter & audit");
    expect(t).not.toMatch(/Home \| About|var x|©/);
  });

  it("recognises a portal sign-in page and does not parse it", () => {
    const html = `<form><input name=email><input type="password" name=pw><button>Sign in</button></form>`;
    expect(looksLikeLoginWall(html, htmlToText(html) + " Sign in to Submittable")).toBe(true);
    const page = `<p>${"Describe your program in detail. ".repeat(200)}</p>`;
    expect(looksLikeLoginWall(page, htmlToText(page))).toBe(false);
  });

  it("fetches only public web addresses", () => {
    expect(fetchableUrl("https://www.example.org/apply").ok).toBe(true);
    for (const bad of ["file:///etc/passwd", "http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/x",
      "http://192.168.1.1", "http://169.254.169.254/latest", "http://[::1]/", "https://user:pw@example.org", "not a url", "http://intranet/"]) {
      expect(fetchableUrl(bad).ok, bad).toBe(false);
    }
  });

  it("tells a PDF from a Word file by content, not only by name", async () => {
    const pdf = await makePdf("hello there, a question?");
    const docx = await makeDocx("hello");
    expect(uploadKind("app.pdf", pdf)).toBe("pdf");
    expect(uploadKind("renamed.docx", pdf)).toBe("pdf");
    expect(uploadKind("app.docx", docx)).toBe("docx");
    expect(uploadKind("app.pdf", docx)).toBeNull();
    expect(uploadKind("notes.txt", new TextEncoder().encode("hi"))).toBeNull();
  });
});
