"use client";
// Full-page garden panel — the plant plus every customization option that used
// to live in the right-side drawer. Opened from /plant (click the sidebar plant).
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { promptHref } from "@/lib/garden-prompt";
import PlantVisual from "./PlantVisual";
import { setPlantAction } from "@/lib/server/garden-actions";
import type { GardenState, PlantSpecies } from "@/lib/types";

const SPECIES: { key: PlantSpecies; name: string }[] = [
  { key: "pothos", name: "Golden Pothos" }, { key: "monstera", name: "Monstera" }, { key: "spider", name: "Spider Plant" },
];
const POT_NAMES: Record<string, string> = { terracotta: "Terracotta", glazed: "Glazed", mosaic: "Mosaic", talavera: "Talavera", porcelain: "Blue & White", jade: "Jade", raku: "Raku" };
const TRINKET_NAMES: Record<string, string> = { fg_flag: "FG flag", gnome: "Garden gnome", mushroom: "Mushroom", crane: "Crane statue", funded_flag: "“WON” flag" };
const VAR_NAMES: Record<string, string> = { variegated: "Variegated leaves", golden: "Golden hue" };
const ACH_NAMES: Record<string, string> = {
  first_doc: "First document", docs_5: "5 documents", docs_10: "10 documents", docs_20: "20 documents", docs_50: "50 documents",
  all_layers: "All three layers", first_interview: "First living voice", size_2: "Established plant", size_3: "Flourishing plant",
  age_6mo: "6 months growing", age_1yr: "One year growing", answers_reviewed_5: "5 answers reviewed",
  grant_submitted: "Grant submitted", grant_won: "Grant won",
};

export default function GardenPanel({ garden }: { garden: GardenState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const g = garden;
  const set = (input: Parameters<typeof setPlantAction>[0]) => start(async () => { await setPlantAction(input); router.refresh(); });
  const healthLabel = g.health === "thriving" ? "Thriving" : g.health === "okay" ? "Doing okay" : "Thirsty";

  if (g.hidden) {
    return (
      <div className="garden-panel">
        <div className="gp-plant-hero" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--muted)" }}>Your plant is hidden.</p>
          <button className="btn inline" disabled={pending} onClick={() => set({ hidden: false })}>&#127793; Show my plant</button>
        </div>
      </div>
    );
  }

  return (
    <div className="garden-panel">
      {g.prompt?.text && (
        <Link href={promptHref(g.prompt)} className="garden-prompt-banner">🌱 {g.prompt.text} <span className="gp-cta">Fix it →</span></Link>
      )}
      <div className="gp-plant-hero">
        <PlantVisual g={g} width={230} />
        <div className="garden-meta" style={{ justifyContent: "center", marginTop: 8 }}>
          <span className={`garden-health ${g.health}`}>{healthLabel}</span>
          <span className="garden-size">Size {g.size} &middot; {g.stats.docs} docs</span>
        </div>
      </div>

      {!g.species && (
        <div className="garden-pick" style={{ justifyContent: "center", marginTop: 8 }}>
          <span>Choose your plant:</span>
          {SPECIES.map(s => <button key={s.key} className="btn ghost" disabled={pending} onClick={() => set({ species: s.key })}>{s.name}</button>)}
        </div>
      )}

      <div className="section-label">Species</div>
      <div className="garden-opts">{SPECIES.map(s => (
        <button key={s.key} className={`chip ${(g.species ?? "pothos") === s.key ? "active" : ""}`} disabled={pending} onClick={() => set({ species: s.key })}>{s.name}</button>))}
      </div>

      <div className="section-label">Pot</div>
      <div className="garden-opts">{g.unlocks.pots.map(p => (
        <button key={p} className={`chip ${g.pot === p ? "active" : ""}`} disabled={pending} onClick={() => set({ pot: p })}>{POT_NAMES[p] ?? p}</button>))}
      </div>

      <div className="section-label">Trinket</div>
      <div className="garden-opts">
        <button className={`chip ${!g.trinket ? "active" : ""}`} disabled={pending} onClick={() => set({ trinket: null })}>None</button>
        {g.unlocks.trinkets.map(t => (
          <button key={t} className={`chip ${g.trinket === t ? "active" : ""}`} disabled={pending} onClick={() => set({ trinket: t })}>{TRINKET_NAMES[t] ?? t}</button>))}
        {g.unlocks.trinkets.length === 0 && <span className="garden-locked">Unlock trinkets by reaching milestones</span>}
      </div>

      <div className="section-label">Leaves</div>
      <div className="garden-opts">
        <button className={`chip ${!g.variegation ? "active" : ""}`} disabled={pending} onClick={() => set({ variegation: null })}>Classic green</button>
        {g.unlocks.variegations.map(v => (
          <button key={v} className={`chip ${g.variegation === v ? "active" : ""}`} disabled={pending} onClick={() => set({ variegation: v })}>{VAR_NAMES[v] ?? v}</button>))}
        {g.unlocks.variegations.length === 0 && <span className="garden-locked">Unlock leaf styles by reviewing Answer Library answers</span>}
      </div>

      <div className="section-label" style={{ marginTop: 10 }}>Milestones ({g.achievements.length})</div>
      <div className="garden-opts">
        {Object.entries(ACH_NAMES).map(([k, name]) => {
          const has = g.achievements.some(a => a.key === k);
          return <span key={k} className={`ach ${has ? "on" : ""}`} title={name}>{has ? "🏆" : "🔒"} {name}</span>;
        })}
      </div>

      <div className="section-label" style={{ marginTop: 10 }}>How your plant is measured</div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
        <b>Size</b>{" "}reflects how complete and fundable your Inven(s)tory is &mdash; mostly your Readiness score and how
        filled-in your eligibility profile is, plus layer coverage and milestones. It never shrinks.
        <b> Health</b> reflects freshness <i>and</i> substance: a recent upload (within ~45 days) keeps it fresh, but
        &ldquo;thriving&rdquo; also needs a robust Inven(s)tory (your Essentials covered) and a complete eligibility
        profile. Quiet stretches make it thirsty (never worse), and it recovers the moment you add something new.
      </p>

      <button className="btn ghost" style={{ marginTop: 8 }} disabled={pending} onClick={() => set({ hidden: true })}>Hide my plant</button>
    </div>
  );
}
