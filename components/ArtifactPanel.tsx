"use client";
// Renders EVERY Story Intelligence artifact type and drives its lifecycle.
import { useState, useTransition } from "react";
import {
  approveSIAction, generateSIAction, regenerateSIAction, removeSICardAction, editSICardAction,
} from "@/lib/server/artifact-actions";
import type { ArtifactBundle, ArtifactCardView } from "@/lib/types";

function Cites({ card, onOpenDoc }: { card: ArtifactCardView; onOpenDoc: (id: string) => void }) {
  return (
    <div>
      <div className="cite-label" title="The documents this card was drawn from.">Sourced from</div>
      <div className="cites">
        {card.citation_docs.map(d => <span key={d.id} className="cite" onClick={() => onOpenDoc(d.id)}>{d.title}</span>)}
      </div>
    </div>
  );
}

function CardBody({ slug, card, editable, onEdit }: {
  slug: string; card: ArtifactCardView; editable: boolean; onEdit: (field: string, value: string) => void;
}) {
  if (slug === "impact_metrics") {
    const p = card.payload;
    if (editable) return (
      <div>
        {(["measures", "why", "how", "formula", "example", "gap"] as const).map(f => (
          <div key={f} className="metric-field"><b>{f}</b>
            <textarea defaultValue={p[f] ?? ""} onBlur={e => { if (e.target.value !== (p[f] ?? "")) onEdit(f, e.target.value); }} style={{ minHeight: 44 }} />
          </div>
        ))}
      </div>
    );
    return (
      <div>
        <div className="metric-field"><b>What it measures</b>{p.measures}</div>
        <div className="metric-field"><b>Why funders care</b>{p.why}</div>
        <div className="metric-field"><b>How to measure it</b>{p.how}</div>
        <div className="metric-field formula">{p.formula}</div>
        <div className="metric-field"><b>From your Inven(s)tory</b>{p.example}</div>
        {p.gap && <div className="metric-gap"><b>Not captured yet:</b> {p.gap}</div>}
      </div>
    );
  }
  return editable
    ? <textarea defaultValue={card.payload.body ?? ""} onBlur={e => { if (e.target.value !== (card.payload.body ?? "")) onEdit("body", e.target.value); }} />
    : <p>{card.payload.body}</p>;
}

export default function ArtifactPanel({ bundle, isAdmin, onOpenDoc }: {
  bundle: ArtifactBundle; isAdmin: boolean; onOpenDoc: (id: string) => void;
}) {
  const { type, set, cards } = bundle;
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const run = (label: string, fn: () => Promise<unknown>) => { setBusy(label); start(async () => { await fn(); setBusy(null); }); };
  const head = <div className="tp-head"><span className="spark">✦</span><h3>{type.name}</h3></div>;
  const working = pending || busy;

  if (set.status === "none") {
    return (
      <div className="themes-panel">{head}
        <p className="tp-sub">{type.description} A For Granted team member reviews every result before it appears here.</p>
        <div className="tp-cta">
          <button className="btn inline" disabled={!!working} onClick={() => run("gen", () => generateSIAction(type.slug))}>
            {busy === "gen" ? "Generating…" : "✦ Generate"}</button>
          <span className="tp-sub" style={{ margin: 0 }}>Runs the synthesis, then goes to the For Granted team for review.</span>
        </div>
      </div>
    );
  }

  if (set.status === "pending" && !isAdmin) {
    return (
      <div className="themes-panel">{head}
        <div className="pending-note"><span className="spinner" />
          Being reviewed by the For Granted team. You&rsquo;ll see it here once approved — usually within a day or two.</div>
      </div>
    );
  }

  const grid = (editable: boolean) => (
    <div className="theme-grid">
      {cards.map(c => (
        <div key={c.id} className="theme-card">
          <h4>{c.title}</h4>
          <CardBody slug={type.slug} card={c} editable={editable}
            onEdit={(field, value) => editSICardAction(type.slug, c.id, field, value)} />
          <Cites card={c} onOpenDoc={onOpenDoc} />
          {editable && <div className="card-tools"><button disabled={!!working} onClick={() => run("rm" + c.id, () => removeSICardAction(type.slug, c.id))}>Remove card</button></div>}
        </div>
      ))}
    </div>
  );

  if (set.status === "pending") {
    return (
      <div className="themes-panel">{head}
        <div className="review-bar">
          <span className="rb-label">DRAFT · awaiting your review{set.model_used === "scaffold" ? " (scaffold — pending AI synthesis)" : ""}</span>
          <span className="tp-sub" style={{ margin: 0 }}>Edit any card, drop weak ones, then publish.</span>
          <span className="spacer" />
          <button className="btn secondary" disabled={!!working} onClick={() => run("regen", () => regenerateSIAction(type.slug))}>{busy === "regen" ? "Regenerating…" : "Regenerate"}</button>
          <button className="btn inline" disabled={!!working} onClick={() => run("approve", () => approveSIAction(type.slug))}>{busy === "approve" ? "Publishing…" : "Approve & publish"}</button>
        </div>
        {grid(true)}
        {set.gap_note && <div className="gap-note"><b>Suggested next step:</b> {set.gap_note}</div>}
      </div>
    );
  }

  // approved / stale
  return (
    <div className="themes-panel">{head}
      {set.status === "stale" && (
        <div className="stale-note">You&rsquo;ve added documents since this was approved.
          {isAdmin && <button className="btn secondary" disabled={!!working} onClick={() => run("regen", () => regenerateSIAction(type.slug))}>{busy === "regen" ? "Regenerating…" : "Regenerate"}</button>}</div>
      )}
      <div className="stamp">Reviewed and approved by <b>For Granted</b>{set.generated_at ? ` · ${new Date(set.generated_at).toLocaleDateString()}` : ""}
        {isAdmin && <button className="btn ghost" style={{ fontSize: 12, padding: "0 6px" }} disabled={!!working} onClick={() => run("regen", () => regenerateSIAction(type.slug))}>{busy === "regen" ? "…" : "↻ Regenerate"}</button>}</div>
      {grid(false)}
      {set.gap_note && <div className="gap-note"><b>Suggested next step:</b> {set.gap_note}</div>}
    </div>
  );
}
