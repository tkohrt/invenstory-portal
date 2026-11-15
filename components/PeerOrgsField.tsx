"use client";
// Peer organizations (patch 48): a few rows of plain text, three to start so
// the page itself says "two or three". Rows, not tags: an organization's name
// can hold a comma, and the tag field splits on them.
import { PEER_MAX } from "@/lib/peers";

export default function PeerOrgsField({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const rows = values.length >= 3 ? values : [...values, ...Array(3 - values.length).fill("")];
  const setRow = (i: number, v: string) => onChange(rows.map((x, j) => (j === i ? v : x)));
  return (
    <div className="peer-rows">
      {rows.map((v, i) => (
        <div key={i} className="peer-row">
          <input aria-label={`Peer organization ${i + 1}`} value={v} maxLength={160}
            placeholder={i === 0 ? "An organization doing work like yours" : i === 1 ? "Another one" : i === 2 ? "One you aspire to be like" : "Another one"}
            onChange={e => setRow(i, e.target.value)} />
          {rows.length > 3 && <button type="button" className="sb-btn sb-quiet sb-sm" aria-label={`Remove ${v || "this organization"}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>}
        </div>
      ))}
      {rows.length < PEER_MAX && <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => onChange([...rows, ""])}>+ Add another</button>}
    </div>
  );
}
