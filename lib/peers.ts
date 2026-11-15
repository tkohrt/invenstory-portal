// Peer organizations (patch 48, 15 November 2026).
//
// A client names two or three organizations like theirs. The who-funds-whom
// graph in Ground Truth then answers "who already funds these?", which the
// dataset's own guide calls its strongest prospecting move. Before this patch
// the portal only ever sent a description of the client, and the graph guessed
// at look-alikes; named peers are evidence the client chose.
//
// Stored in the setup answers (tenant_setup.answers.peer_orgs), so there is no
// migration. Pure and tested: tests/funding/peers.test.ts.
import type { FunderCard } from "./ledger-types";

/** Ground Truth reads the first eight peers of a question and ignores the rest. */
export const PEER_MAX = 8;
/** What we ask for. Fewer still works; this is the point where the evidence starts to agree with itself. */
export const PEER_ASK = 2;

/**
 * Names (or EINs) worth sending. Ground Truth matches a name by "contains",
 * so anything under three characters would match half the graph and is dropped
 * there too; dropping it here keeps what is stored honest about what is used.
 */
export function cleanPeerOrgs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const name = x.replace(/\s+/g, " ").trim().slice(0, 160);
    if (name.length < 3) continue;
    if (out.some(o => o.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
    if (out.length >= PEER_MAX) break;
  }
  return out;
}

const einOf = (f: Pick<FunderCard, "ein">) => String(f.ein ?? "").replace(/\D/g, "");

/**
 * Say what the evidence is. The graph's own wording is "Already funds 2 org(s)
 * like yours", written for look-alikes it found itself; for peers the client
 * named, the truer sentence is that it funds the organizations they named.
 */
export function peerReason(f: FunderCard): FunderCard {
  const n = Array.isArray(f.evidence_grantees) ? f.evidence_grantees.length : 0;
  if (!n) return f;
  const detail = (f.match_reason ?? "").split(": ").slice(1).join(": ");
  const lead = n === 1 ? "Already funds a peer you named" : `Already funds ${n} of the peers you named`;
  return { ...f, match_reason: detail ? `${lead}: ${detail}` : `${lead}.` };
}

/**
 * One evidence list from the two graph questions: funders of the named peers
 * first, then funders of the look-alikes the graph found from the description.
 * A funder in both appears once, carrying the named-peer evidence, because the
 * rows downstream keep the first card they meet for a funder.
 */
export function mergePeerEvidence(fromPeers: FunderCard[], fromDescription: FunderCard[]): FunderCard[] {
  const seen = new Set<string>();
  const out: FunderCard[] = [];
  // A card with neither an EIN nor a name cannot be matched to another, so it is kept.
  const key = (f: FunderCard) => einOf(f) || (f.name ? `name:${String(f.name).toLowerCase()}` : "");
  for (const f of [...fromPeers.map(peerReason), ...fromDescription]) {
    const k = key(f);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(f);
  }
  return out;
}

// ---- Checking a name against Ground Truth (patch 49) ----
//
// Ground Truth finds a peer two ways: a nine-digit EIN exactly, or a name by
// "contains", case ignored, taking the first three records that contain it.
// So "ACE Mentor Program" finds three chapters in other cities and never
// reaches Cleveland's, and "ace mentor cleveland" finds nothing at all. The
// person typing has no way to know either happened unless we say so.

/** Nine digits, with or without spaces and hyphens: Ground Truth treats it as an EIN. */
export function isEin(v: string): boolean {
  return /^[\d\s-]+$/.test(v) && v.replace(/\D/g, "").length === 9;
}

/** The recipient names Ground Truth says it matched (the wire's `matched_similar_orgs`). */
export function matchedOrgs(raw: unknown): string[] {
  const list = (raw as { matched_similar_orgs?: unknown } | null)?.matched_similar_orgs;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === "string").map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** A name with case, punctuation and a trailing Inc or LLC removed, for telling two spellings of one name apart from two names. */
export function nameKey(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(incorporated|inc|llc|ltd|corporation|corp|co)$/, "");
}

/** One entry per name, first spelling kept. */
export function distinctOrgs(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) { const k = nameKey(n); if (!k || seen.has(k)) continue; seen.add(k); out.push(n); }
  return out;
}

export type PeerCheck =
  /** One organization, or the exact name typed. `shared` means other records contain the same words. */
  | { kind: "found"; name: string; shared: boolean }
  /** The words match more than one organization and none is exactly what was typed. */
  | { kind: "several"; options: string[] }
  /** Nothing contains what was typed, but these are close. */
  | { kind: "suggest"; options: string[] }
  | { kind: "missing"; ein: boolean }
  /** Ground Truth did not answer. Say nothing rather than guess. */
  | { kind: "unchecked" };

const OPTION_MAX = 6;

/**
 * What to tell the person about one name. `exact` is what Ground Truth matched
 * for the name as typed; `similar` is what its meaning-based search found for
 * the same words, used only to offer choices.
 */
export function peerCheck(typed: string, exact: string[], similar: string[] = []): PeerCheck {
  const names = distinctOrgs(exact);
  if (isEin(typed)) return names.length ? { kind: "found", name: names[0], shared: false } : { kind: "missing", ein: true };
  const key = nameKey(typed);
  const same = names.find(n => nameKey(n) === key);
  if (same) return { kind: "found", name: same, shared: names.length > 1 };
  if (names.length === 1) return { kind: "found", name: names[0], shared: false };
  const options = distinctOrgs([...names, ...similar]).slice(0, OPTION_MAX);
  if (names.length > 1) return { kind: "several", options };
  return options.length ? { kind: "suggest", options } : { kind: "missing", ein: false };
}

/**
 * Is what is in the boxes different from what is saved? (patch 51). Compared
 * after cleaning, so an empty row, a stray space or a change of capitals is
 * not an edit: only something the save would actually store differently is.
 */
export function peersChanged(typed: unknown, saved: unknown): boolean {
  const a = cleanPeerOrgs(typed), b = cleanPeerOrgs(saved);
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}
