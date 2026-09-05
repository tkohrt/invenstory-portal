"use client";
// The people who actually read the letter, recorded as you find them.
//
// Entry lives beside the verification form because that is when the fact
// arrives: somebody has just read a funder's team page or come off a call. A
// separate admin screen would mean the contact gets written into a doc instead,
// which is where these have been evaporating.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addFunderContactAction, updateContactStatusAction, getFunderContactsAction,
} from "@/lib/server/funder-contacts";
import {
  CONTACT_ROLES, ROLE_LABEL, SOURCE_TYPES, SOURCE_LABEL, SOURCE_HELP,
  freshness, type ContactRecord,
} from "@/lib/funder-contact";

const BLANK = {
  name: "", title: "", role: "program_officer", portfolio: "",
  email: "", phone: "", source_type: "funder_site", source_url: "", note: "",
};

export default function FunderContacts({ ein, funderName, sourceUrl }: {
  ein: string; funderName: string; sourceUrl?: string;
}) {
  const router = useRouter();
  const [existing, setExisting] = useState<ContactRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...BLANK });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (p: Partial<typeof BLANK>) => setF({ ...f, ...p });

  // Loaded per funder rather than prefetched: which funder is attached is not
  // known until somebody picks one.
  const reload = () => start(async () => {
    try { setExisting(await getFunderContactsAction(ein)); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not read contacts."); }
    setLoaded(true);
  });
  useEffect(reload, [ein]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => start(async () => {
    setErr(null);
    try {
      await addFunderContactAction({ ...f, ein, source_url: f.source_url || sourceUrl });
      setF({ ...BLANK }); setOpen(false); reload(); router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save that contact.");
    }
  });

  const mark = (id: string, status: "active" | "departed") => start(async () => {
    try { await updateContactStatusAction(id, status); reload(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update that contact."); }
  });

  return (
    <div className="fc">
      <div className="fc-head">
        <strong>Who reads the letter</strong>
        <span className="ov-muted"> at {funderName}</span>
        {!open && <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Add a person</button>}
      </div>

      <p className="ov-note">
        Program officers and grants managers, not the 990 officers. Those are the
        board. For Granted only: none of this reaches a client&apos;s screen.
      </p>

      {existing.length > 0 && (
        <ul className="fc-list">
          {existing.map(c => {
            const fr = freshness(c.last_verified_at);
            const gone = c.status === "departed";
            return (
              <li key={c.id} className={gone ? "fc-gone" : ""}>
                <div>
                  <span className="fc-name">{c.name}</span>
                  {c.title && <span className="ov-muted"> · {c.title}</span>}
                  {gone && <span className="ov-tag fc-departed">Has left</span>}
                </div>
                <div className="fc-meta">
                  {ROLE_LABEL[c.role]}
                  {c.portfolio ? ` · ${c.portfolio}` : ""}
                  {c.email ? ` · ${c.email}` : ""}
                  {c.phone ? ` · ${c.phone}` : ""}
                </div>
                <div className="fc-meta">
                  <span title={SOURCE_HELP[c.source_type]}>{SOURCE_LABEL[c.source_type]}</span>
                  {" · "}
                  <span className={fr.stale ? "fc-stale" : ""}
                        title={fr.stale
                          ? "Nobody has confirmed this in over a year. People move; check before writing to them."
                          : "Recently confirmed."}>
                    {fr.label}
                  </span>
                  {!gone && (
                    <>
                      {" · "}
                      <button type="button" className="fc-link" disabled={pending}
                              onClick={() => mark(c.id, "active")}
                              title="Record that you have just confirmed this person still holds the role.">
                        still there
                      </button>
                      {" · "}
                      <button type="button" className="fc-link" disabled={pending}
                              onClick={() => mark(c.id, "departed")}
                              title="Record that they have left. The row stays, so nobody re-enters them from a stale page.">
                        has left
                      </button>
                    </>
                  )}
                </div>
                {c.note && <div className="fc-note">{c.note}</div>}
              </li>
            );
          })}
        </ul>
      )}

      {!existing.length && !open && loaded && (
        <div className="empty">
          Nobody recorded yet. Their team page is usually the fastest source; a
          name from a call is worth more.
        </div>
      )}

      {open && (
        <div className="fc-form">
          <div className="aq-grid">
            <label>Name <span className="oe-req">required</span>
              <input value={f.name} onChange={e => set({ name: e.target.value })} placeholder="Alex Rivera" />
            </label>
            <label>Title, as they write it
              <input value={f.title} onChange={e => set({ title: e.target.value })} placeholder="Program Officer" />
            </label>
            <label>What are they for?
              <select value={f.role} onChange={e => set({ role: e.target.value })}>
                {CONTACT_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <label>Portfolio
              <input value={f.portfolio} onChange={e => set({ portfolio: e.target.value })}
                     placeholder="Public Education" />
            </label>
            <label>Email
              <input value={f.email} onChange={e => set({ email: e.target.value })} />
            </label>
            <label>Phone
              <input value={f.phone} onChange={e => set({ phone: e.target.value })} />
            </label>
            <label>Where did this come from?
              <select value={f.source_type} onChange={e => set({ source_type: e.target.value })}>
                {SOURCE_TYPES.map(s => <option key={s} value={s} title={SOURCE_HELP[s]}>{SOURCE_LABEL[s]}</option>)}
              </select>
            </label>
            <label>Link to it
              <input value={f.source_url} onChange={e => set({ source_url: e.target.value })}
                     placeholder={sourceUrl || "https://funder.org/our-team"} />
            </label>
          </div>
          <label>Note
            <textarea rows={2} value={f.note} onChange={e => set({ note: e.target.value })}
                      placeholder="What they said, what they care about, who introduced you. Internal only." />
          </label>
          {err && <div className="ov-err">{err}</div>}
          <div className="al-actions">
            <button className="btn" onClick={save} disabled={pending || !f.name.trim()}>
              {pending ? "Saving…" : "Save contact"}
            </button>
            <button className="btn ghost" onClick={() => { setOpen(false); setErr(null); }} disabled={pending}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
