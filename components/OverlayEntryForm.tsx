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
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<OverlayManualEntry>) => setF({ ...f, ...patch });
  const isGrant = f.kind === "grant";

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

      <div className="aq-grid">
        <label>Record type
          <select value={f.kind} onChange={e => set({ kind: e.target.value as OverlayKind })}>
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
        <label>Ledger record ID
          <input value={f.base_id} onChange={e => set({ base_id: e.target.value })}
                 placeholder="blank = brand-new record" />
        </label>
      </div>

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

      <div className="al-actions">
        <button className="btn" onClick={submit} disabled={pending || !f.source_url.trim()}>
          {pending ? "Saving…" : "Add to review queue"}
        </button>
        <button className="btn ghost" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </div>
  );
}
