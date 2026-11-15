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
