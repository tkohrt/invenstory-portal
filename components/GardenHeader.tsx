"use client";
// Top-center garden: plant + rotating prompt + species picker + details drawer
// (achievements, pots, trinkets, variegation). Click the prompt -> upload drawer.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PlantVisual from "./PlantVisual";
import Drawer from "./Drawer";
import { setPlantAction } from "@/lib/server/garden-actions";
import type { ReactNode } from "react";
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

export default function GardenHeader({ garden, onPrompt, rightSlot }: { garden: GardenState; onPrompt: (layer: "I"|"II"|"III"|null) => void; rightSlot?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const g = garden;
  const set = (input: Parameters<typeof setPlantAction>[0]) => start(async () => { await setPlantAction(input); router.refresh(); });
  const healthLabel = g.health === "thriving" ? "Thriving" : g.health === "okay" ? "Doing okay" : "Thirsty";

  return (
    <div className="garden">
      <button className="garden-prompt" onClick={() => onPrompt(g.prompt.layer)}>
        🌱 {g.prompt.text} <span className="gp-cta">Upload →</span>
      </button>
      {!g.hidden && !g.species && (
        <div className="garden-pick">
          <span>Choose your plant:</span>
          {SPECIES.map(s => <button key={s.key} className="btn ghost" disabled={pending} onClick={() => set({ species: s.key })}>{s.name}</button>)}
        </div>
      )}
      <div className="garden-row">
        {g.hidden ? (
          <div className="garden-left garden-hidden">
            <button className="btn ghost garden-show" disabled={pending} onClick={() => set({ hidden: false })}>🌱 Show my plant</button>
          </div>
        ) : (
          <div className="garden-left">
            <button className="garden-plant" onClick={() => setOpen(true)} title="Open your garden">
              <PlantVisual g={g} width={230} />
            </button>
            <div className="garden-meta">
              <span className={`garden-health ${g.health}`}>{healthLabel}</span>
              <span className="garden-size">Size {g.size} · {g.stats.docs} docs</span>
            </div>
          </div>
        )}
        {rightSlot}
      </div>

      {open && (
        <Drawer onClose={() => setOpen(false)}>
          <h3 style={{ color: "#3a7d44", marginTop: 14 }}>Grow your Inven(s)tory</h3>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>Your plant grows as your Inven(s)tory grows — and perks up whenever you add something new.</p>
          <div style={{ textAlign: "center", margin: "10px 0" }}><PlantVisual g={g} width={230} /></div>

          <div className="section-label">Species</div>
          <div className="garden-opts">{SPECIES.map(s => (
            <button key={s.key} className={`chip ${ (g.species ?? "pothos") === s.key ? "active" : ""}`} disabled={pending} onClick={() => set({ species: s.key })}>{s.name}</button>))}
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

          <div className="section-label">Milestones ({g.achievements.length})</div>
          <div className="garden-opts">
            {Object.entries(ACH_NAMES).map(([k, name]) => {
              const has = g.achievements.some(a => a.key === k);
              return <span key={k} className={`ach ${has ? "on" : ""}`} title={name}>{has ? "🏆" : "🔒"} {name}</span>;
            })}
          </div>

          <div className="section-label">How your plant is measured</div>
          <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
            <b>Size</b> grows with documents, words captured, layer coverage, and milestones — it never shrinks.
            <b> Health</b> reflects freshness: uploads within ~45 days keep it thriving; quiet stretches make it thirsty
            (never worse), and one new document perks it right back up. Keeping Layer III current matters most.
          </p>
          <button className="btn ghost" style={{ marginTop: 8 }} disabled={pending} onClick={() => { set({ hidden: true }); setOpen(false); }}>Hide my plant</button>
        </Drawer>
      )}
    </div>
  );
}
