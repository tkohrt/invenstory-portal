"use client";
// The funder dossier (patch 40): one page per matched funder, the portal-native
// funder brain. Everything shown was already earned — the cached match, the
// graph evidence, Ground Truth verification, and the shape (never the content)
// of For Granted's contacts. The page ends in a relationship action, not an
// application form: that is what makes Funder Compass the strategy product.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FunderRow } from "@/lib/funder-rows";
import type { ContactRecord } from "@/lib/funder-contact";
import { ROLE_LABEL } from "@/lib/funder-contact";
import { ACCESS_LABEL, ACCESS_HELP } from "@/lib/access-mode";
import { requestApproachAction, refreshFunderLinksAction } from "@/lib/server/dossier-actions";
import { pullFunder990Action, pullFunderGrantsAction } from "@/lib/server/irs990-actions";
import type { getFunderGrants } from "@/lib/server/irs990-grants";
import type { ContactShadow } from "@/lib/server/dossier";
import type { FunderProfileRecord, EngagementRow } from "@/lib/server/funder-profile";
import { FACT_FIELDS, provenanceLine, type FieldProvenance } from "@/lib/funder-profile";
import { ALL_LINKS, CLIENT_LINKS, LINK_LABEL } from "@/lib/funder-links";

const SOURCE_LINE: Record<string, string> = {
  ledger: "From the funder ledger (GrantX base plus For Granted's corrections).",
  iati: "From IATI, the international aid transparency registry.",
};

export default function FunderDossierView({ funder, shadow, contacts, profile, history, filingGrants = null, isAdmin, viewingAsClient, knownAs }: {
  funder: FunderRow;
  shadow: ContactShadow | null;
  /** Full records, admin sessions only; a client session never loads them. */
  contacts: ContactRecord[];
  /** The shared funder profile (patch 41), read live. */
  profile: FunderProfileRecord | null;
  /** Cross-client engagement history; empty for every non-admin session. */
  history: EngagementRow[];
  /** 990 phase two (patch 45): the latest ingested filing's grant list. */
  filingGrants?: Awaited<ReturnType<typeof getFunderGrants>> | null;
  isAdmin: boolean;
  viewingAsClient: boolean;
  /** How the client already knows this funder (company setup), if they do. */
  knownAs: string | null;
}) {
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true); setErr(null);
    const r = await requestApproachAction(funder.funder_id, funder.name).catch(() => ({ ok: false as const, error: "That did not send. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setAsked(true);
  };
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const evidence = (funder.evidence ?? []).filter(e => e.name);
  const asClient = !isAdmin || viewingAsClient;

  return (
    <div className="dossier">
      <p className="do-back"><a href={`/funding?mode=funders&focus=${encodeURIComponent(`f:${funder.funder_id}`)}`}>← Back to Funding</a></p>
      <div className="page-head">
        <div>
          <h2>{funder.name}</h2>
          <p className="do-sub">
            {funder.location && <span>{funder.location}</span>}
            <span className={`ov-tag fm-acc-${funder.access_mode}${funder.access_verified ? "" : " fm-acc-guess"}`}
              title={ACCESS_HELP[funder.access_mode]}>
              {ACCESS_LABEL[funder.access_mode]}{funder.access_verified ? "" : " (likely)"}</span>
            {funder.verified_at
              ? <span className="do-verified" title="For Granted confirmed this record at the funder's own materials.">✓ Confirmed by For Granted on {day(funder.verified_at)}</span>
              : <span className="do-unverified">Not yet verified: check the funder&rsquo;s page before relying on details.</span>}
          </p>
        </div>
        <div className="spacer" />
        {funder.website && <a className="sb-btn sb-secondary sb-sm" href={funder.website} target="_blank" rel="noopener noreferrer">Their website ↗</a>}
        {isAdmin && !viewingAsClient && (
          <a className="sb-btn sb-secondary sb-sm" href={`/draft/new?funder=${encodeURIComponent(funder.funder_id)}`}>Draft toward this funder</a>
        )}
      </div>

      {knownAs && <div className="do-known">Already known to you: {knownAs}. Your existing relationship beats any cold approach; this dossier is for deepening it.</div>}
      {funder.caveat && <div className="do-caveat">{funder.caveat}</div>}

      {/* The giving record's own numbers (patch 45), led by the NEW-GRANTEE
          RATE: the best "can an outsider get in" signal a filing can give. */}
      {(profile?.fields.new_grantee_rate !== undefined || profile?.fields.typical_grant_usd !== undefined) && (
        <div className="do-stats">
          {profile?.fields.new_grantee_rate !== undefined && (
            <div className="do-stat do-stat-rate">
              <b>{String(profile.fields.new_grantee_rate)}%</b>
              <span>new-grantee rate</span>
              <em>{rateRead(Number(profile.fields.new_grantee_rate))}</em>
            </div>
          )}
          {profile?.fields.typical_grant_usd !== undefined && (
            <div className="do-stat"><b>${Math.round(Number(profile.fields.typical_grant_usd)).toLocaleString()}</b><span>typical grant</span></div>
          )}
          {profile?.fields.grants_count !== undefined && (
            <div className="do-stat"><b>{String(profile.fields.grants_count)}</b><span>grants paid{profile?.fields.fy_year !== undefined ? ` in ${profile.fields.fy_year}` : ""}</span></div>
          )}
        </div>
      )}

      <section className="do-sec">
        <h3>Why this funder</h3>
        {funder.match_reason ? <p>{funder.match_reason}</p> : <p className="do-muted">No written rationale on file for this match yet.</p>}
        {funder.from_graph && <p className="do-graph" title="From the who-funds-whom graph, not from topic similarity.">This funder came from the giving record itself: it already funds organizations like yours.</p>}
      </section>

      <section className="do-sec">
        <h3>Who they already fund</h3>
        {evidence.length ? (
          <>
            <p className="do-muted">Grantees like your organization, from the giving history on record. Evidence for an approach, not a guarantee.</p>
            <table className="do-table">
              <thead><tr><th>Organization</th><th>Granted</th><th>Most recent</th></tr></thead>
              <tbody>
                {evidence.map((e, i) => (
                  <tr key={i}><td>{e.name}</td><td>{e.total_usd != null ? usd(e.total_usd) : "On record"}</td><td>{e.latest_year ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
            {(funder.evidence_count || 0) > evidence.length && <p className="do-muted">And {funder.evidence_count - evidence.length} more on record.</p>}
          </>
        ) : funder.has_grant_history === false ? (
          <p className="do-muted">No outgoing grants on file. Often an operating charity that delivers services itself rather than funding others; worth a look only with another reason.</p>
        ) : (
          <p className="do-muted">No peer grantees on file for this match. The giving record may still exist; it was not what surfaced this funder.</p>
        )}
        {filingGrants && (
          <>
            <h4 className="do-sub-h">From their {filingGrants.year} filing ({filingGrants.total} grants on record)</h4>
            <table className="do-table">
              <thead><tr><th>Recipient</th><th>Amount</th><th>Purpose</th><th>State</th></tr></thead>
              <tbody>
                {filingGrants.top.map((g, i) => (
                  <tr key={i}><td>{g.recipient}</td><td>{g.amount !== null ? `$${Math.round(g.amount).toLocaleString()}` : ""}</td><td className="do-purpose">{g.purpose ?? ""}</td><td>{g.recipient_state ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="do-muted">Straight from the foundation&rsquo;s own 990-PF, Part XV.</p>
          </>
        )}
        {isAdmin && !viewingAsClient && funder.ein && <PullGrants funderId={funder.funder_id} ein={funder.ein} />}
      </section>

      <section className="do-sec">
        <h3>About</h3>
        <dl className="do-facts">
          {funder.focus && <><dt>Focus</dt><dd>{funder.focus}</dd></>}
          {funder.mission && <><dt>Mission</dt><dd>{funder.mission}</dd></>}
          {funder.typical_grant_range && <><dt>Typical grants</dt><dd>{funder.typical_grant_range}</dd></>}
          {funder.access_note && <><dt>How they take requests</dt><dd>{funder.access_note}</dd></>}
          {/* The shared profile (patch 41): read live, one fact for every client,
              each with its own provenance. Empty fields simply do not render. */}
          {FACT_FIELDS.map(def => {
            const v = profile?.fields[def.key];
            if (v === undefined || v === null || v === "") return null;
            const m = profile?.meta[def.key] as FieldProvenance | undefined;
            return (
              <FieldRow key={def.key} label={def.label}
                value={def.kind === "usd" ? `$${Math.round(Number(v)).toLocaleString()}` : String(v)}
                prov={m ?? null} />
            );
          })}
          {funder.ein && <><dt>EIN</dt><dd>{funder.ein}</dd></>}
        </dl>
        <FunderLinks funder={funder} profile={profile} admin={isAdmin && !viewingAsClient} />
        <p className="do-muted">{SOURCE_LINE[funder.source ?? "ledger"] ?? SOURCE_LINE.ledger}</p>
        {/* The 990 importer (patch 42), decided 13 Nov: mechanical figures from
            the funder's own sworn filing write straight to the shared profile,
            stamped import_990 with the filing as source. Button-first. */}
        {isAdmin && !viewingAsClient && funder.ein && <Pull990 funderId={funder.funder_id} ein={funder.ein} />}
      </section>

      <section className="do-sec" id="do-relationship">
        <h3>The relationship</h3>
        {isAdmin && !viewingAsClient ? (
          contacts.length ? (
            <table className="do-table">
              <thead><tr><th>Name</th><th>Title</th><th>Role</th><th>Portfolio</th><th>Status</th></tr></thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}><td>{c.name}</td><td>{c.title ?? ""}</td><td>{ROLE_LABEL[c.role] ?? c.role}</td><td>{c.portfolio ?? ""}</td><td>{c.status}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="do-muted">No contacts on file for this funder yet.</p>
        ) : shadow ? (
          <p>
            For Granted has {shadow.count} verified contact{shadow.count === 1 ? "" : "s"} at this funder
            {shadow.roles.length ? <>, including {shadow.roles.map(r => r.toLowerCase()).join(" and ")}{shadow.portfolios.length ? ` on the ${shadow.portfolios.join(", ")} side` : ""}</> : null}.
            Contact details stay with For Granted; the approach is a conversation, not a mailing list.
          </p>
        ) : (
          <p className="do-muted">No verified contacts at this funder yet. An approach request still starts the work: For Granted maps the path in.</p>
        )}
        {asClient && (
          asked
            ? <p className="cu-asked">Request sent. Your For Granted team will follow up to talk approach strategy.</p>
            : <button type="button" className="sb-btn sb-primary" disabled={busy || viewingAsClient}
                title={viewingAsClient ? "The as-client preview cannot send requests." : undefined}
                onClick={() => void ask()}>{busy ? "Sending…" : "Request an approach"}</button>
        )}
        {err && <p className="cl-error">{err}</p>}
      </section>

      {/* For Granted's own picture, never a client's (patch 41): drafts across
          ALL clients that reference this funder. Rendering is gated on a real
          admin session; the page never even loads it otherwise. */}
      {isAdmin && !viewingAsClient && history.length > 0 && (
        <section className="do-sec do-admin">
          <h3>For Granted&rsquo;s history with this funder <span className="do-adm-tag">For Granted only</span></h3>
          <table className="do-table">
            <thead><tr><th>Client</th><th>Draft</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}><td>{h.tenant_name}</td><td>{h.title}</td><td>{h.submitted ? "submitted" : h.status}</td><td>{new Date(h.updated_at).toLocaleDateString()}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/** The rate, read honestly (patch 45). Mirrors lib/irs990-grants rateSentence. */
function rateRead(r: number): string {
  return r >= 50 ? "genuinely open to new names"
    : r >= 25 ? "open to new names, with a stable core"
    : r >= 10 ? "mostly repeat grantees; the way in is narrow"
    : "almost entirely repeat grantees; a relationship play";
}

/** The admin's grant-list pull (patch 45). */
function PullGrants({ funderId, ein }: { funderId: string; ein: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pull = async () => {
    setBusy(true); setMsg(null);
    const r = await pullFunderGrantsAction(funderId, ein).catch(() => ({ ok: false as const, status: "error" as const, error: "That did not finish. Try again." }));
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(`✓ Read ${r.count} grants from the ${r.years.join(" and ")} filing${r.years.length > 1 ? "s" : ""}.${r.sentence ? ` ${r.sentence}` : " Pull again when the next filing lands to unlock the new-grantee rate."}`);
    router.refresh();
  };
  return (
    <p className="do-pull">
      <button type="button" className="sb-btn sb-secondary sb-sm" onClick={pull} disabled={busy}>
        {busy ? "Reading the filing…" : "Pull their grant list"}</button>
      <span className="su-small"> Reads Part XV of their 990-PF: every grant they paid, and the new-grantee rate.</span>
      {msg && <span className="do-pull-msg">{msg}</span>}
    </p>
  );
}

/** The admin's one-click filing pull (patch 42). */
function Pull990({ funderId, ein }: { funderId: string; ein: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pull = async () => {
    setBusy(true); setMsg(null);
    const r = await pullFunder990Action(funderId, ein).catch(() => ({ ok: false as const, status: "error" as const, error: "That did not finish. Try again." }));
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(r.changed.length
      ? `✓ Filled ${r.changed.length} field${r.changed.length === 1 ? "" : "s"} from the ${r.year} filing. Every client's dossier has them now.`
      : `The ${r.year} filing holds nothing newer than what is already on file.`);
    router.refresh();
  };
  return (
    <p className="do-pull">
      <button type="button" className="sb-btn sb-secondary sb-sm" onClick={pull} disabled={busy}>
        {busy ? "Pulling…" : "Pull the 990"}</button>
      <span className="su-small"> Fills assets, giving and filing year from the funder&rsquo;s own IRS filing.</span>
      {msg && <span className="do-pull-msg">{msg}</span>}
    </p>
  );
}

/**
 * The funder's own channels (patch 63): the links its own website publishes,
 * read once and shared across every client. Following a funder before asking
 * is ordinary relationship work, so clients see the row too; the feed address
 * and the re-check are For Granted's.
 */
function FunderLinks({ funder, profile, admin }: { funder: FunderRow; profile: FunderProfileRecord | null; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const keys = (admin ? ALL_LINKS : CLIENT_LINKS).filter(k => typeof profile?.fields[k] === "string" && /^https?:\/\//i.test(String(profile?.fields[k])));
  const prov = keys.map(k => profile?.meta[k] as FieldProvenance | undefined).find(Boolean) ?? null;
  const checked = typeof profile?.fields.links_checked_at === "string" ? String(profile.fields.links_checked_at) : null;
  if (!keys.length && !admin) return null;
  const recheck = async () => {
    setBusy(true); setMsg(null);
    const r = await refreshFunderLinksAction(funder.funder_id);
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(r.found ? `Found ${r.found} link${r.found === 1 ? "" : "s"} on their site${r.changed ? "" : ", none new"}.` : "Their site links to no social accounts, newsletter or feed that could be recognized.");
    router.refresh();
  };
  return (
    <div className="do-links">
      <b>Follow this funder</b>
      {keys.length
        ? keys.map(k => <a key={k} href={String(profile?.fields[k])} target="_blank" rel="noopener noreferrer">{LINK_LABEL[k]} ↗</a>)
        : <span className="do-muted">{funder.website ? (checked ? "Their website links to no accounts that could be recognized." : "Not looked up yet. Their site is read the first time this page is opened; reload in a moment.") : "No website on record to read."}</span>}
      {prov && <span className="do-prov">{provenanceLine(prov)}</span>}
      {admin && funder.website && (
        <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy} onClick={() => void recheck()}
          title="Read the funder's own website again for its social, newsletter and feed links. Links it no longer shows are kept until corrected in Ground Truth.">
          {busy ? "Reading their site…" : "Check their site again"}
        </button>
      )}
      {msg && <span className="do-muted" role="status">{msg}</span>}
    </div>
  );
}

/** One shared-profile fact with its own provenance line. */
function FieldRow({ label, value, prov }: { label: string; value: string; prov: FieldProvenance | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}{prov && (
        <span className="do-prov" title={prov.source_url ?? undefined}>
          {provenanceLine(prov)}{prov.source_url && <> · <a href={prov.source_url} target="_blank" rel="noopener noreferrer">source ↗</a></>}
        </span>
      )}</dd>
    </>
  );
}
