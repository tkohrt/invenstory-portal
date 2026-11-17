// The review list in front of every upload (patch 59).
import { describe, expect, it } from "vitest";
import { addLabel, sizeLabel, stageFiles, stageKey, unaddedNotice } from "@/lib/upload-stage";

const f = (name: string, size = 1000) => ({ name, size });

describe("stageFiles", () => {
  it("lists accepted files in arrival order with the default type", () => {
    const r = stageFiles([], [f("report.pdf"), f("budget.xlsx", 20)], "");
    expect(r.staged.map(s => s.name)).toEqual(["report.pdf", "budget.xlsx"]);
    expect(r.staged.every(s => s.typeTag === "" && s.outcome === "")).toBe(true);
    expect(r.refused).toEqual([]);
  });

  it("carries a pre-set type, as the funder-form box does", () => {
    expect(stageFiles([], [f("form.pdf")], "funder_form").staged[0].typeTag).toBe("funder_form");
  });

  it("refuses a type the portal does not read, and says what to do", () => {
    const r = stageFiles([], [f("deck.pptx"), f("ok.docx")]);
    expect(r.staged.map(s => s.name)).toEqual(["ok.docx"]);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0].name).toBe("deck.pptx");
    expect(r.refused[0].reason).toContain("Email it to");
  });

  it("does not list the same file twice, in one pick or across picks", () => {
    const first = stageFiles([], [f("a.pdf"), f("a.pdf")]);
    expect(first.staged).toHaveLength(1);
    expect(first.duplicates).toBe(1);
    const again = stageFiles(first.staged, [f("a.pdf"), f("b.pdf")]);
    expect(again.staged.map(s => s.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(again.duplicates).toBe(1);
  });

  it("treats the same name at a different size as a different file", () => {
    expect(stageFiles([], [f("a.pdf", 1), f("a.pdf", 2)]).staged).toHaveLength(2);
    expect(stageKey(f("a.pdf", 1))).not.toBe(stageKey(f("a.pdf", 2)));
  });

  it("keeps a type the person already chose when more files join", () => {
    const first = stageFiles([], [f("a.pdf")]);
    first.staged[0].typeTag = "irs_990";
    const more = stageFiles(first.staged, [f("b.pdf")]);
    expect(more.staged[0].typeTag).toBe("irs_990");
    expect(more.staged[1].typeTag).toBe("");
  });

  it("does not change the list it was given", () => {
    const before = stageFiles([], [f("a.pdf")]).staged;
    stageFiles(before, [f("b.pdf")]);
    expect(before).toHaveLength(1);
  });
});

describe("the words", () => {
  it("counts documents on the Add button", () => {
    expect(addLabel(1)).toBe("Add 1 document");
    expect(addLabel(3)).toBe("Add 3 documents");
  });
  it("says how many files are still waiting", () => {
    expect(unaddedNotice(1)).toBe("1 file is chosen but not added yet.");
    expect(unaddedNotice(4)).toBe("4 files are chosen but not added yet.");
  });
  it("writes sizes a person can read", () => {
    expect(sizeLabel(512)).toBe("512 B");
    expect(sizeLabel(860 * 1024)).toBe("860 KB");
    expect(sizeLabel(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(sizeLabel(-1)).toBe("");
  });
});
