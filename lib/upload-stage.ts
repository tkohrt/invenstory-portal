// The review list in front of every upload (patch 59, 17 Nov 2026).
//
// Until this patch a chosen or dropped file started uploading at once, and
// reading began as it landed: a wrong file was stored and read before anybody
// could stop it, and the document type had to be picked BEFORE choosing files,
// one type for the whole batch. Now files wait in a "Ready to add" list, each
// with its own type and a Remove button, and nothing is sent until the person
// presses Add. These are the pure rules; components/UploadPanel.tsx holds the
// File objects and the screen.
import { SUPPORT_EMAIL, isAccepted } from "@/lib/uploads";

/** What the list knows about one waiting file (the File itself stays in the component). */
export interface StagedInfo { key: string; name: string; size: number; typeTag: string; outcome: string }

/** One waiting file is one name at one size: choosing the same file twice does not list it twice. */
export const stageKey = (f: { name: string; size: number }): string => `${f.name}::${f.size}`;

export interface StageResult {
  /** The list after the new files joined it, in arrival order. */
  staged: StagedInfo[];
  /** Files the portal does not read, with what to do instead. */
  refused: { name: string; reason: string }[];
  /** How many were already waiting and so were not listed again. */
  duplicates: number;
}

/** Add newly chosen files to the waiting list. Nothing here uploads anything. */
export function stageFiles(existing: StagedInfo[], incoming: { name: string; size: number }[], defaultType = ""): StageResult {
  const staged = [...existing];
  const have = new Set(existing.map(s => s.key));
  const refused: StageResult["refused"] = [];
  let duplicates = 0;
  for (const f of incoming) {
    if (!isAccepted(f.name)) {
      refused.push({ name: f.name, reason: `Not a type the portal reads. Email it to ${SUPPORT_EMAIL} and we will add it.` });
      continue;
    }
    const key = stageKey(f);
    if (have.has(key)) { duplicates++; continue; }
    have.add(key);
    staged.push({ key, name: f.name, size: f.size, typeTag: defaultType, outcome: "" });
  }
  return { staged, refused, duplicates };
}

/** The Add button: "Add 1 document", "Add 3 documents". */
export const addLabel = (n: number): string => `Add ${n} document${n === 1 ? "" : "s"}`;

/** Said when somebody moves on with files still waiting. */
export const unaddedNotice = (n: number): string =>
  n === 1 ? "1 file is chosen but not added yet." : `${n} files are chosen but not added yet.`;

/** A file size a person can read: 840 KB, 3.2 MB. */
export function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
