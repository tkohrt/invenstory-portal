"use client";
// "Record a verification" — the human feed into the living overlay.
//
// The person filling this in has just come back from a funder's website with
// one or two facts that differ from the June 2026 snapshot. So: typed fields
// not JSON, everything optional except the source URL, and blank means "leave
// the base record alone" rather than "erase it".
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addOverlayRecordAction } from "@/lib/server/overlay-actions";
import FunderPicker from "./FunderPicker";
import GrantPicker from "./GrantPicker";
import type { PickerResult, FunderPrefill } from "@/lib/server/ledger-lookup";
import type { GrantPickerResult } from "@/lib/server/grant-lookup";
import type { OverlayManualEntry, OverlayKind, OverlayConfidence } from "@/lib/types";
import type { Tenant } from "@/lib/types";

const BLANK: OverlayManualEntry = {
  kind: "funder", base_id: "", source_url: "", surfaced_for_tenant: "", confidence: "high",
  title: "", ein: "", opportunity_number: "", name: "", website: "", location: "",
  focus: "", typical_grant_range: "", agency: "", close_date: "",
  min_award: "", max_award: "", eligibility: "", caveat: "", notes: "",
};

export default function OverlayEntryForm({ tenants, onDone }: { tenants: Tenant[]; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<OverlayManualEntry>(BLANK);
  // The picker is the default path for funders. `manual` is the escape hatch for
  // a service outage or a genuinely new funder, and keeps the original
  // free-text id field available rather than blocking the entry entirely.
  const [manual, setManual] = useState(false);
  const [attached, setAttached] = useState<PickerResult | null>(null);
  const [attachedGrant, setAttachedGrant] = useState<GrantPickerResult | null>(null);
  // Whose match list the grant picker is browsing. Deliberately separate from
  // f.surfaced_for_tenant: that field decides provenance ("found while working
  // a client"), and an admin who opens a client's list to look around, then
  // pastes an unrelated URL, must not have the proposal permanently attributed
  // to that client.
  const [browseTenant, setBrowseTenant] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<OverlayManualEntry>) => setF({ ...f, ...patch });
  const isGrant = f.kind === "grant";
  // Each kind gets the picker that can actually resolve an id for it: name
  // search for funders, recent matches or a source URL for grants. `manual` is
  // the escape hatch on both sides.
  const showFunderPicker = !isGrant && !manual && !attached;
  const showGrantPicker = isGrant && !manual && !attachedGrant;
  const showPicker = showFunderPicker || showGrantPicker;

  /** Attach to a real record and prefill, so the reviewer edits what changed. */
  const attach = (r: PickerResult, p: FunderPrefill) => {
    setAttached(r);
    setF({
      ...f,
      base_id: r.ein,               // consistent, correct, and never guessed
      ein: r.ein,
      title: r.name ?? f.title,
      name: p.name ?? r.name ?? "",
      website: p.website ?? "",
      location: p.location ?? r.location ?? "",
      focus: p.focus ?? "",
      typical_grant_range: p.typical_grant_range ?? "",
    });
  };

  /**
   * Attach to a grant. base_id is the id qualifyGrantIds assigned before the
   * merge and cached verbatim as eligible_grant.grant_id — the one string the
   * merge, the cache and this form all have to agree on.
   *
   * Rebuilt from BLANK rather than spread over `f`: a form that was a funder a
   * moment ago still holds name, location, focus and typical_grant_range, and
   * every non-empty field is written into `fields` and merged wholesale onto
   * the target record. The grant inputs are not even rendered for those keys,
   * so the reviewer could neither see nor clear them.
   *
   * source_url is deliberately NOT prefilled from the cached row. It is the
   * required field precisely because it records where a HUMAN verified this;
   * filling it from a database nobody checked would satisfy the submit gate
   * while answering the wrong question.
   */
  const attachGrant = (r: GrantPickerResult, fromList: boolean) => {
    setAttachedGrant(r);
    setF({
      ...BLANK,
      kind: "grant",
      // Picking a grant OUT of a client's list is a real signal that it came up
      // working for them; merely browsing is not, which is why this is set here
      // and not when the browse selector changes.
      surfaced_for_tenant: fromList ? browseTenant : f.surfaced_for_tenant,
      confidence: f.confidence,
      base_id: r.base_id,
      opportunity_number: r.base_id,
      title: r.title ?? "",
      agency: r.funder ?? "",
      website: r.url ?? "",
      close_date: r.close_date ?? "",
    });
  };

  /**
   * Changing kind starts the entry over.
   *
   * An id from one side is meaningless on the other, but so is every other
   * value: carrying a funder's name, location and grant range into a grant
   * proposal writes them into `fields`, and on approval they merge onto the
   * grant record for every tenant. Only the two answers that are true
   * regardless of kind survive — which client this came up for, and how sure
   * the person is.
   */
  const setKind = (kind: OverlayKind) => {
    setAttached(null); setAttachedGrant(null); setManual(false);
    setF({ ...BLANK, kind, surfaced_for_tenant: f.surfaced_for_tenant, confidence: f.confidence });
  };

  const submit = () => start(async () => {
    setErr(null);
    try {
      await addOverlayRecordAction(f);
      setF(BLANK);
      onDone();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save that.");
    }
  });

  return (
    <div className="aq-editor oe-form">
      <p className="oe-lede">
        Record what you verified at the source. It lands in the queue as a proposal,
        the same as anything the bot finds, and merges into matching once approved.
        Leave a field blank to leave the base record&apos;s value alone.
      </p>

      {showPicker && (
        <label className="oe-kind">Record type
          <select value={f.kind} onChange={e => setKind(e.target.value as OverlayKind)}>
            <option value="funder">Funder</option>
            <option value="grant">Grant / opportunity</option>
          </select>
        </label>
      )}

      {showFunderPicker && (
        <FunderPicker
          onAttach={attach}
          onManual={() => { setManual(true); setF({ ...f, base_id: "" }); }}
        />
      )}

      {showGrantPicker && (
        <GrantPicker
          tenants={tenants}
          tenantId={browseTenant}
          onTenant={setBrowseTenant}
          onAttach={attachGrant}
          onManual={() => { setManual(true); setF({ ...f, base_id: "" }); }}
        />
      )}

      {attached && (
        <div className="fp-attached">
          Recording a verification for <strong>{attached.name}</strong>
          <span className="ov-muted"> · EIN {attached.ein}</span>
          <button type="button" className="btn ghost" onClick={() => { setAttached(null); setF(BLANK); }}>
            Change funder
          </button>
        </div>
      )}

      {attachedGrant && (
        <div className="fp-attached">
          Recording a verification for <strong>{attachedGrant.title || attachedGrant.base_id}</strong>
          {attachedGrant.funder && <span className="ov-muted"> · {attachedGrant.funder}</span>}
          <button type="button" className="btn ghost"
                  onClick={() => { setAttachedGrant(null); setF({ ...BLANK, kind: "grant" }); }}>
            Change opportunity
          </button>
        </div>
      )}

      <div className="aq-grid" style={showPicker ? { display: "none" } : undefined}>
        <label>Record type
          <select value={f.kind} onChange={e => setKind(e.target.value as OverlayKind)}>
            <option value="funder">Funder</option>
            <option value="grant">Grant / opportunity</option>
          </select>
        </label>
        <label>Found while working
          <select value={f.surfaced_for_tenant ?? ""} onChange={e => set({ surfaced_for_tenant: e.target.value })}>
            <option value="">Not client-specific</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>How sure are you?
          <select value={f.confidence ?? ""} onChange={e => set({ confidence: (e.target.value || null) as OverlayConfidence | null })}>
            <option value="high">High — read it on their site</option>
            <option value="medium">Medium — inferred</option>
            <option value="low">Low — worth a second look</option>
          </select>
        </label>
        {manual && (
          <label>Record id
            <input value={f.base_id} onChange={e => set({ base_id: e.target.value })}
                   placeholder={isGrant ? "the opportunity's source URL, or blank if new"
                                        : "EIN, or blank for a funder not in the base"} />
          </label>
        )}
      </div>

      {!showPicker && <>
      <label>Source URL <span className="oe-req">required</span>
        <input value={f.source_url} onChange={e => set({ source_url: e.target.value })}
               placeholder="https://funder.org/grants — where you verified this" />
      </label>

      <label>Title
        <input value={f.title} onChange={e => set({ title: e.target.value })}
               placeholder={isGrant ? "e.g. Community Recovery Fund 2027" : "e.g. Manna Scholarship Foundation"} />
      </label>

      <div className="aq-grid">
        {isGrant ? (
          <>
            <label>Opportunity number
              <input value={f.opportunity_number} onChange={e => set({ opportunity_number: e.target.value })} />
            </label>
            <label>Funder / agency
              <input value={f.agency} onChange={e => set({ agency: e.target.value })} />
            </label>
            <label>Deadline
              <input type="date" value={f.close_date} onChange={e => set({ close_date: e.target.value })} />
            </label>
            <label>Award ceiling
              <input value={f.max_award} onChange={e => set({ max_award: e.target.value })} placeholder="50000" />
            </label>
          </>
        ) : (
          <>
            <label>EIN
              <input value={f.ein} onChange={e => set({ ein: e.target.value })} placeholder="86-3418425" />
            </label>
            <label>Legal name
              <input value={f.name} onChange={e => set({ name: e.target.value })} />
            </label>
            <label>Location
              <input value={f.location} onChange={e => set({ location: e.target.value })} placeholder="Columbus, OH" />
            </label>
            <label>Typical grant range
              <input value={f.typical_grant_range} onChange={e => set({ typical_grant_range: e.target.value })} placeholder="$10,000–$50,000" />
            </label>
          </>
        )}
        <label>Website
          <input value={f.website} onChange={e => set({ website: e.target.value })} />
        </label>
        {!isGrant && (
          <label>Focus
            <input value={f.focus} onChange={e => set({ focus: e.target.value })} placeholder="Health, Human Services…" />
          </label>
        )}
      </div>

      <label>Eligibility, in their words
        <textarea rows={2} value={f.eligibility} onChange={e => set({ eligibility: e.target.value })}
                  placeholder="Quote or paraphrase what the site actually says about who can apply." />
      </label>

      <label>Caveat
        <input value={f.caveat} onChange={e => set({ caveat: e.target.value })}
               placeholder="e.g. donor-advised fund, not an open application — relayed verbatim to anyone who sees this" />
      </label>

      <label>Notes
        <textarea rows={2} value={f.notes} onChange={e => set({ notes: e.target.value })}
                  placeholder="Anything that doesn't fit a field: who you spoke to, what changed, why it matters." />
      </label>

      {err && <div className="ov-err">{err}</div>}
      </>}

      <div className="al-actions">
        <button className="btn" onClick={submit} disabled={pending || !f.source_url.trim()}>
          {pending ? "Saving…" : "Add to review queue"}
        </button>
        <button className="btn ghost" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </div>
  );
}
