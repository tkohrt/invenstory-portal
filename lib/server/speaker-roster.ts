import "server-only";
// Working out who is in the room.
//
// The obvious approach, reading the names off the speaker labels, does not
// work: two of RE-Assist's three transcripts label everybody "Speaker 1",
// "Speaker 2", "Speaker 3" and never name a soul. Who they are has to be
// inferred from what they say, which a model is good at and a regex is not.
//
// One call per document, not per window, and stored, so a rebuild does not pay
// for it again.
import { db } from "./db";
import { chatComplete } from "./llm";
import {
  looksLikeTranscript, speakerLabels,
  type SpeakerRoster, type Speaker,
} from "@/lib/transcript-speakers";

/** Enough to place everybody. The introductions are always at the top. */
const OPENING_CHARS = 6000;

const SYS =
  "You are reading the opening of a recorded meeting to work out who is speaking.\n\n"
  + "You will be given the name of ONE organization and a list of the speaker labels used in the "
  + "transcript. Decide, for each label, whether that speaker belongs to that organization.\n\n"
  + "HOW TO TELL. People from the organization say \"we\" and \"our\" about its work, describe "
  + "building or running it, and are congratulated, advised or questioned about it. Everyone else "
  + "is an outsider: an investor, an adviser, a consultant, a partner, a funder, a facilitator. "
  + "Being enthusiastic about the organization does not make somebody part of it, and neither does "
  + "having introduced the meeting.\n\n"
  + "RULES.\n"
  + "1. Every judgement needs a VERBATIM quote from the text that shows it. No quote, no judgement.\n"
  + "2. If the opening does not show which side a speaker is on, say so by omitting is_client. "
  + "Leaving it out is a correct answer and far better than a guess.\n"
  + "3. Give a name only if the text states one. Do not infer a name from a role.\n\n"
  + "Return STRICT JSON only: {\"speakers\":[{\"label\":\"<exactly as given>\","
  + "\"is_client\":true|false,\"name\":\"<or null>\",\"evidence\":\"<verbatim>\"}]}. "
  + "Omit is_client entirely when unsure.";

function parseRoster(raw: string, labels: string[], chars: number): SpeakerRoster | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }

  const rows = (parsed as { speakers?: unknown[] })?.speakers;
  if (!Array.isArray(rows)) return null;

  const known = new Set(labels.map(l => l.toLowerCase()));
  const speakers: Speaker[] = [];
  for (const r of rows) {
    const o = r as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    // Only labels that actually appear. A model inventing a fourth speaker
    // would otherwise put a judgement against nobody.
    if (!label || !known.has(label.toLowerCase())) continue;

    const evidence = typeof o.evidence === "string" ? o.evidence.trim() : "";
    const claimed = typeof o.is_client === "boolean" ? o.is_client : undefined;
    speakers.push({
      label,
      // Enforced here rather than asked for: a judgement with no quote behind
      // it is exactly the kind of confident guess this whole feature exists to
      // undo, so it is downgraded to unknown.
      ...(claimed !== undefined && evidence ? { isClient: claimed } : {}),
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : null,
      evidence: evidence || null,
    });
  }
  if (!speakers.length) return null;
  return { chars, speakers };
}

/**
 * The roster for one document, computed if needed and stored on the document.
 *
 * Returns null for anything that is not a transcript, which is the signal to
 * leave attribution exactly as it was. Best-effort throughout: a failure here
 * must not stop a document being read, it only means this document keeps the
 * behaviour it had before this existed.
 */
export async function speakerRosterFor(
  tenantId: string, documentId: string, title: string, orgName: string, text: string,
  stored: SpeakerRoster | null,
): Promise<SpeakerRoster | null> {
  if (!looksLikeTranscript(text)) return null;
  // Reuse unless the document has been re-processed, which changes its length.
  if (stored && stored.chars === text.length && stored.speakers.length) return stored;

  const labels = speakerLabels(text);
  if (labels.length < 2) return null;

  const res = await chatComplete({
    system: SYS,
    user: `ORGANIZATION: ${orgName}\nDOCUMENT: ${title}\n`
      + `SPEAKER LABELS: ${labels.join(", ")}\n\nOPENING OF THE TRANSCRIPT:\n`
      + text.slice(0, OPENING_CHARS),
    maxTokens: 900, temperature: 0,
  });
  if (!res) return null;

  const roster = parseRoster(res.text, labels, text.length);
  if (!roster) return null;

  const { error } = await db.from("document")
    .update({ speaker_roster: roster })
    .eq("tenant_id", tenantId).eq("id", documentId);
  if (error) console.error("[speakers] could not store the roster", error);

  return roster;
}
