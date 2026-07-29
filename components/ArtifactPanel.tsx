"use client";
// One panel renders EVERY artifact type — the engine's UI half.
// Type-specific rendering is confined to CardBody below.
import { getArtifactCards, getDocument, getUser } from "@/lib/data";
import type { ArtifactCard, ArtifactSet, ArtifactType } from "@/lib/types";

function Cites({ card, onOpenDoc }: { card: ArtifactCard; onOpenDoc: (id: string) => void }) {
  return (
    <div>
      <div className="cite-label" title="The documents this card was drawn from.">Sourced from</div>
      <div className="cites">
        {card.citations.map(id => {
          const d = getDocument(card.tenant_id, id);
          return d ? <span key={id} className="cite" onClick={() => onOpenDoc(id)}>{d.title}</span> : null;
        })}
      </div>
    </div>
  );
}

function CardBody({ type, card }: { type: ArtifactType; card: ArtifactCard }) {
  if (type.slug === "impact_metrics") {
    const p = card.payload;
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
  return <p>{card.payload.body}</p>;
}

export default function ArtifactPanel({
  type, set, isAdmin, onOpenDoc,
}: { type: ArtifactType; set: ArtifactSet; isAdmin: boolean; onOpenDoc: (id: string) => void }) {
  const head = (
    <div className="tp-head"><span className="spark">✦</span><h3>{type.name}</h3></div>
  );

  if (set.status === "none") {
    return (
      <div className="themes-panel">{head}
        <p className="tp-sub">{type.description} A For Granted team member reviews every result before it appears here.</p>
        <div className="tp-cta">
          <button className="btn inline">✦ Generate</button>
          <span className="tp-sub" style={{ margin: 0 }}>Takes a moment, then goes to the For Granted team for review. (Live in Phase 7.)</span>
        </div>
      </div>
    );
  }

  const cards = getArtifactCards(set.id);

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
          {editable ? <textarea defaultValue={c.payload.body ?? c.payload.measures} /> : <CardBody type={type} card={c} />}
          <Cites card={c} onOpenDoc={onOpenDoc} />
          {editable && <div className="card-tools"><button>Remove card</button></div>}
        </div>
      ))}
    </div>
  );

  if (set.status === "pending") {
    return (
      <div className="themes-panel">{head}
        <div className="review-bar">
          <span className="rb-label">DRAFT · awaiting your review</span>
          <span className="tp-sub" style={{ margin: 0 }}>Edit any card, drop weak ones, then publish to the client.</span>
          <span className="spacer" />
          <button className="btn secondary">Regenerate</button>
          <button className="btn inline">Approve &amp; publish</button>
        </div>
        {grid(true)}
        {set.gap_note && <div className="gap-note"><b>Suggested next step:</b> {set.gap_note}</div>}
      </div>
    );
  }

  const reviewer = set.reviewed_by ? getUser(set.reviewed_by)?.full_name ?? "For Granted" : "For Granted";
  return (
    <div className="themes-panel">{head}
      {set.status === "stale" && (
        <div className="stale-note">Documents have been added since this was approved.
          <button className="btn secondary">Regenerate</button></div>
      )}
      <div className="stamp">Reviewed and approved by <b>{reviewer} · For Granted</b>{set.generated_at ? ` · ${new Date(set.generated_at).toLocaleDateString()}` : ""}</div>
      {grid(false)}
      {set.gap_note && <div className="gap-note"><b>Suggested next step:</b> {set.gap_note}</div>}
    </div>
  );
}
