"use client";
// Peer organizations (patch 48): a few rows of plain text, three to start so
// the page itself says "two or three". Rows, not tags: an organization's name
// can hold a comma, and the tag field splits on them.
//
// Each name is checked against Ground Truth as the person leaves the box
// (patch 49), and what was found is said under it: the organization matched,
// a choice when the words fit several, a suggestion when they fit none.
import { useEffect, useRef, useState } from "react";
import { PEER_MAX, type PeerCheck } from "@/lib/peers";
import { checkPeerOrgAction } from "@/lib/server/peer-actions";

type Shown = PeerCheck | { kind: "checking" };
const keyOf = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();

export default function PeerOrgsField({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const rows = values.length >= 3 ? values : [...values, ...Array(3 - values.length).fill("")];
  const [checks, setChecks] = useState<Record<string, Shown>>({});
  const asked = useRef(new Set<string>());
  const setRow = (i: number, v: string) => onChange(rows.map((x, j) => (j === i ? v : x)));

  const check = (v: string) => {
    const k = keyOf(v);
    if (k.length < 3 || asked.current.has(k)) return;
    asked.current.add(k);
    setChecks(c => ({ ...c, [k]: { kind: "checking" } }));
    checkPeerOrgAction(v)
      .then(r => setChecks(c => ({ ...c, [k]: r })))
      .catch(() => setChecks(c => ({ ...c, [k]: { kind: "unchecked" } })));
  };
  // Names already saved are checked once when the page opens, so a client
  // coming back, or an admin viewing them, sees which ones landed.
  useEffect(() => { values.forEach(check); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const pick = (i: number, name: string) => { setRow(i, name); check(name); };

  return (
    <div className="peer-rows">
      {rows.map((v, i) => {
        const st = v.trim() ? checks[keyOf(v)] : undefined;
        return (
          <div key={i} className="peer-item">
            <div className="peer-row">
              <input aria-label={`Peer organization ${i + 1}`} value={v} maxLength={160}
                placeholder={i === 0 ? "An organization doing work like yours" : i === 1 ? "Another one" : i === 2 ? "One you aspire to be like" : "Another one"}
                onChange={e => setRow(i, e.target.value)} onBlur={e => check(e.target.value)} />
              {rows.length > 3 && <button type="button" className="sb-btn sb-quiet sb-sm" aria-label={`Remove ${v || "this organization"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>}
            </div>
            {st && st.kind !== "unchecked" && (
              <div className={`peer-check ${st.kind}`} role="status">
                {st.kind === "checking" && <>Checking our funding data…</>}
                {st.kind === "found" && <>
                  <b>✓ Found:</b> {st.name}
                  {st.shared && <span className="peer-check-more"> Other organizations share this name. Enter its EIN instead to be exact.</span>}
                </>}
                {st.kind === "several" && <>
                  <b>These words fit more than one organization.</b> Choose the one you mean, or enter its EIN:
                  <Options options={st.options} onPick={n => pick(i, n)} />
                </>}
                {st.kind === "suggest" && <>
                  <b>We could not find that exact name.</b> Did you mean one of these?
                  <Options options={st.options} onPick={n => pick(i, n)} />
                  <span className="peer-check-more">If none is right, try its full legal name or its EIN.</span>
                </>}
                {st.kind === "missing" && (st.ein
                  ? <><b>No organization with that EIN is in our funding data.</b> Check the number, or enter its name.</>
                  : <><b>Not found in our funding data.</b> Check the spelling, or try its full legal name or EIN. It may simply have no US foundation grants on record, in which case it cannot help the search.</>)}
              </div>
            )}
          </div>
        );
      })}
      {rows.length < PEER_MAX && <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => onChange([...rows, ""])}>+ Add another</button>}
    </div>
  );
}

function Options({ options, onPick }: { options: string[]; onPick: (name: string) => void }) {
  return (
    <span className="peer-options">
      {options.map(o => <button key={o} type="button" className="peer-option" onClick={() => onPick(o)}>{o}</button>)}
    </span>
  );
}
