"use client";
// The Inven(s)tory plant — parameterized SVG grounded in real plant anatomy.
// v3 per Tyler's art direction: irregular, asymmetric growth (no uniform radial
// fans), petioles on every pothos leaf, curved monstera stems with realistic
// fenestrations, spider blades that arch UP before spilling, and an Overhang
// that grows continuously out of the plant and over the layer cards.
import type { ReactElement } from "react";
import type { GardenState, PlantSpecies } from "@/lib/types";

const GREENS = { dark: "#3f6b42", mid: "#5c8f5e", light: "#8fbc8f", pale: "#c9dfc0" };
const GOLDEN = { dark: "#8a7a34", mid: "#ab9847", light: "#cbbd72", pale: "#e4dbae" };
const YELLOW = "#c9b458";
const ROOT = "#a08363";
type Palette = typeof GREENS;

function potPaint(pot: string): { fill: string; extra?: ReactElement } {
  switch (pot) {
    case "glazed": return { fill: "#4e7a9b", extra: <rect x="-34" y="5" width="68" height="6" rx="3" fill="#7fa6c4" /> };
    case "mosaic": return { fill: "#8a6d5c", extra: <g>{[-26,-12,2,16].map((x,i)=><rect key={i} x={x} y={10+(i%2)*10} width="9" height="9" rx="1.5" fill={["#c94f4f","#4e7a9b","#d9a441","#5c8f5e"][i]} />)}</g> };
    case "talavera": return { fill: "#f2ede4", extra: <g>{[-24,-6,12].map((x,i)=><circle key={i} cx={x+4} cy={18} r="4.4" fill="#2f5d9b" />)}<path d="M-34,8 H34" stroke="#2f5d9b" strokeWidth="2.5"/></g> };
    case "porcelain": return { fill: "#f7f7f4", extra: <path d="M-30,18 q8,-8 16,0 t16,0 t16,0" stroke="#3a6ea8" strokeWidth="2.5" fill="none" /> };
    case "jade": return { fill: "#7fa88b", extra: <rect x="-34" y="5" width="68" height="4" rx="2" fill="#a4c4ab" /> };
    case "raku": return { fill: "#4a4038", extra: <path d="M-18,3 q6,18 -3,34" stroke="#b87a4b" strokeWidth="3" fill="none" opacity=".8" /> };
    default: return { fill: "#c1704f", extra: <rect x="-36" y="0" width="72" height="7" rx="2.5" fill="#a85c3f" /> };
  }
}
function Trinket({ kind }: { kind: string | null }) {
  if (!kind) return null;
  if (kind === "gnome") return <g transform="translate(26,14)"><ellipse cx="0" cy="14" rx="6" ry="7" fill="#e8e2d4" /><path d="M-6,9 L0,-7 L6,9 Z" fill="#c94f4f" /><circle cx="0" cy="9" r="3" fill="#e8b89b" /></g>;
  if (kind === "mushroom") return <g transform="translate(-30,18)"><rect x="-2.4" y="0" width="4.8" height="9" rx="2" fill="#e8e2d4" /><path d="M-8,2 a8,6 0 0 1 16,0 Z" fill="#c94f4f" /><circle cx="-3" cy="-1" r="1.2" fill="#fff" /><circle cx="3" cy="0" r="1.2" fill="#fff" /></g>;
  if (kind === "crane") return <g transform="translate(29,10)" fill="#8b8b8b"><path d="M0,17 L0,5 Q0,0 5,-2 Q10,-4 10,-8 Q10,-11 6,-11 Q11,-12 12,-7 Q12,-2 7,0 Q2,2 2,7 L2,17 Z" /></g>;
  if (kind === "funded_flag") return <g transform="translate(-30,2)"><rect x="0" y="0" width="2" height="26" fill="#8a7a54" /><path d="M2,1 h19 l-5,5 5,5 h-19 Z" fill="#d9b943" /><text x="5" y="8.6" fontSize="5.4" fontWeight="700" fill="#5c4d1e">WON</text></g>;
  return <g transform="translate(-30,2)"><rect x="0" y="0" width="2" height="26" fill="#8a7a54" /><rect x="2" y="1" width="17" height="10" rx="2" fill="#1a1a1a" /><text x="5" y="8.8" fontSize="6" fontWeight="700" fill="#fff">FG</text></g>;
}
function Bloom({ kind, x, y }: { kind: "bud" | "flower"; x: number; y: number }) {
  if (kind === "bud") return <g transform={`translate(${x},${y})`}><path d="M0,6 Q-4,0 0,-5 Q4,0 0,6 Z" fill="#d98aa8" /><circle cy="-4" r="1.8" fill="#e8b3c8" /></g>;
  return <g transform={`translate(${x},${y})`}>{[0,72,144,216,288].map(a=><ellipse key={a} cx="0" cy="-5" rx="3" ry="5.4" fill="#e39ab5" transform={`rotate(${a})`} />)}<circle r="2.8" fill="#e8cf6a" /></g>;
}

// ---------- shared leaf pieces ----------
function Heart({ C, fill, s, variegated }: { C: Palette; fill: string; s: number; variegated?: boolean }) {
  return (
    <g transform={`scale(${s})`}>
      <path d="M0,13 C-13,5 -17,-8 -8,-14 C-3,-17 0,-14 0,-10 C0,-14 3,-17 8,-14 C17,-8 13,5 0,13 Z" fill={fill} />
      {variegated && <path d="M-3,3 C-8,-1 -9,-8 -4,-11 C-1,-12 0,-8 0,-6 C2,-10 6,-10 7,-6 C8,-1 3,4 -3,3 Z" fill={C.pale} opacity=".9" />}
      <path d="M0,12 C-1,4 -1,-4 0,-11" stroke={C.dark} strokeWidth="1" opacity=".4" fill="none" />
    </g>
  );
}
// Pothos leaf WITH petiole: petiole curves from attachment to the leaf base.
function PothosLeaf({ C, fill, s, rot, variegated }: { C: Palette; fill: string; s: number; rot: number; variegated?: boolean }) {
  return (
    <g transform={`rotate(${rot})`}>
      <path d={`M0,0 C ${2*s},${5*s} ${1*s},${9*s} 0,${13*s}`} stroke={C.dark} strokeWidth={1.6*s} fill="none" transform="scale(1,-1)" />
      <g transform={`translate(0,${-16*s})`}><Heart C={C} fill={fill} s={s} variegated={variegated} /></g>
    </g>
  );
}

// ---------- POTHOS: irregular crown + trailing vines with petioled leaves ----------
const POTHOS_CROWN: { x: number; y: number; r: number; s: number }[] = [
  { x: -14, y: -6, r: -34, s: 1.0 }, { x: 9, y: -10, r: 18, s: 1.15 }, { x: -3, y: -2, r: -6, s: 0.8 },
  { x: 21, y: -2, r: 52, s: 0.85 }, { x: -25, y: 2, r: -66, s: 0.8 }, { x: -7, y: -14, r: -14, s: 1.05 },
  { x: 15, y: -16, r: 30, s: 0.9 }, { x: 3, y: -20, r: 6, s: 0.95 }, { x: 27, y: -12, r: 64, s: 0.65 },
  { x: -19, y: -18, r: -44, s: 0.7 },
];
function PothosVinePath({ C, d, leaves, variegated, yellowFirst }: { C: Palette; d: string; leaves: { t: { x: number; y: number }; rot: number; s: number }[]; variegated: boolean; yellowFirst?: boolean }) {
  return (
    <g>
      <path d={d} stroke={C.mid} strokeWidth="2.2" fill="none" />
      {leaves.map((l, i) => (
        <g key={i} transform={`translate(${l.t.x},${l.t.y})`}>
          <PothosLeaf C={C} fill={yellowFirst && i === 0 ? YELLOW : i % 2 ? C.mid : C.dark} s={l.s} rot={l.rot} variegated={variegated && i % 2 === 0} />
        </g>
      ))}
    </g>
  );
}
function Pothos({ size, C, droop, health, variegated }: { size: 1|2|3; C: Palette; droop: number; health: string; variegated: boolean }) {
  const n = size === 3 ? 10 : size === 2 ? 7 : 4;
  const crown = POTHOS_CROWN.slice(0, n);
  return (
    <g>
      {crown.map((L, i) => (
        <g key={i} transform={`translate(${L.x},${L.y}) rotate(${droop * (L.r >= 0 ? 0.4 : -0.4)})`}>
          <PothosLeaf C={C} s={L.s} rot={L.r} variegated={variegated && i % 3 === 0}
            fill={health === "thirsty" && i === n - 1 ? YELLOW : i % 3 === 1 ? C.mid : i % 3 === 2 ? C.light : C.dark} />
        </g>
      ))}
      {size >= 2 && (
        <PothosVinePath C={C} variegated={variegated}
          d="M28,-2 C 46,6 58,22 60,44 C 61,58 56,72 48,82"
          leaves={[{ t: { x: 50, y: 30 }, rot: 70, s: 0.72 }, { t: { x: 58, y: 58 }, rot: 100, s: 0.62 }, { t: { x: 50, y: 80 }, rot: 130, s: 0.5 }]} />
      )}
      {size === 3 && (
        <PothosVinePath C={C} variegated={variegated} yellowFirst={health === "thirsty"}
          d="M-30,0 C -48,8 -58,24 -60,46 C -61,64 -58,84 -60,104"
          leaves={[{ t: { x: -50, y: 24 }, rot: -68, s: 0.78 }, { t: { x: -60, y: 52 }, rot: -100, s: 0.68 }, { t: { x: -58, y: 82 }, rot: -128, s: 0.58 }, { t: { x: -60, y: 102 }, rot: -95, s: 0.5 }]} />
      )}
    </g>
  );
}

// ---------- MONSTERA: curved stems, asymmetric leaves, real fenestrations ----------
function MonsteraLeaf({ C, fill, s, flip, slits, variegated }: { C: Palette; fill: string; s: number; flip?: boolean; slits: 2 | 3; variegated?: boolean }) {
  return (
    <g transform={`scale(${flip ? -s : s},${s})`}>
      <path fillRule="evenodd" fill={fill} d={`
        M0,18 C-26,14 -36,-4 -28,-22 C-22,-34 -6,-42 6,-38 C20,-33 30,-18 24,-2 C19,11 12,16 0,18 Z
        M-33,-12 L-9,-15 L-10,-10 Z
        M-30,0 L-8,-4 L-9,0 Z
        ${slits === 3 ? "M-28,-24 L-9,-24 L-10,-20 Z" : ""}
        M28,-10 L8,-13 L9,-8 Z
        M22,4 L6,0 L7,5 Z
        M-5,-26 a2.6,4.4 0 1 0 0.1,0 Z
        M7,-20 a2.1,3.6 0 1 0 0.1,0 Z
        M-3,-10 a1.9,3.2 0 1 0 0.1,0 Z`} />
      <path d="M0,17 C-1,6 -1,-14 2,-34" stroke={C.dark} strokeWidth="1.5" opacity=".5" fill="none" />
      {variegated && <path d="M8,-24 C15,-26 20,-19 16,-11 C11,-8 6,-14 8,-24 Z" fill={C.pale} opacity=".9" />}
    </g>
  );
}
const MONSTERA_STEMS: { bx: number; d: string; tip: { x: number; y: number }; rot: number; s: number; flip?: boolean; slits: 2 | 3 }[] = [
  { bx: -6, d: "M-6,0 C -14,-22 -30,-34 -44,-46", tip: { x: -46, y: -54 }, rot: -22, s: 0.92, flip: true, slits: 3 },
  { bx: 2,  d: "M2,0 C 4,-30 -2,-52 -6,-72",     tip: { x: -6, y: -82 },  rot: -6,  s: 1.22, slits: 3 },
  { bx: 8,  d: "M8,0 C 16,-24 34,-36 48,-42",     tip: { x: 52, y: -50 },  rot: 26,  s: 1.0, slits: 2 },
  { bx: -2, d: "M-2,0 C -6,-18 -16,-24 -20,-26",  tip: { x: -22, y: -34 }, rot: -38, s: 0.68, flip: true, slits: 2 },
  { bx: 6,  d: "M6,0 C 10,-40 22,-58 20,-70",     tip: { x: 20, y: -80 },  rot: 12,  s: 1.05, slits: 3 },
  { bx: -8, d: "M-8,0 C -18,-10 -30,-12 -38,-10", tip: { x: -44, y: -14 }, rot: -66, s: 0.6, flip: true, slits: 2 },
  { bx: 12, d: "M12,0 C 22,-8 34,-8 42,-4",       tip: { x: 48, y: -8 },   rot: 62,  s: 0.66, slits: 2 },
];
function Monstera({ size, C, droop, yellowIdx, variegated }: { size: 1|2|3; C: Palette; droop: number; yellowIdx: number; variegated: boolean }) {
  const stems = MONSTERA_STEMS.slice(0, size === 3 ? 7 : size === 2 ? 5 : 3);
  return (
    <g>
      {size === 3 && <>{/* air roots from the main stem base, over the LEFT pot rim */}
        <path d="M0,-2 C -16,4 -30,10 -40,22 C -46,30 -48,42 -46,54" stroke={ROOT} strokeWidth="2.8" fill="none" opacity=".95" />
        <path d="M-2,0 C -20,8 -36,20 -44,38 C -48,50 -46,66 -48,80" stroke={ROOT} strokeWidth="2.2" fill="none" opacity=".85" />
      </>}
      {stems.map((st, i) => (
        <g key={i} transform={`rotate(${droop * (st.tip.x >= 0 ? 0.5 : -0.5)})`}>
          <path d={st.d} stroke={C.dark} strokeWidth="2.6" fill="none" />
          <g transform={`translate(${st.tip.x},${st.tip.y}) rotate(${st.rot})`}>
            <MonsteraLeaf C={C} s={st.s * 0.92} flip={st.flip} slits={st.slits} variegated={variegated && i % 3 === 0}
              fill={i === yellowIdx ? YELLOW : i % 3 === 0 ? C.dark : i % 3 === 1 ? C.mid : C.light} />
          </g>
        </g>
      ))}
    </g>
  );
}

// ---------- SPIDER: blades arch UP first, spill outside the pot ----------
function SpiderBlade({ angle, len, C, stripe, fill }: { angle: number; len: number; C: Palette; stripe: string; fill: string }) {
  const dir = angle >= 0 ? 1 : -1;
  const L = 84 * len;
  const arch = 26 * len * dir;               // rises near-vertical, then arcs outward
  return (
    <g transform={`rotate(${angle})`}>
      <path d={`M0,0 C ${dir*2},${-L*0.5} ${arch*0.5},${-L*0.92} ${arch},${-L} C ${arch*1.35},${-L*0.97} ${arch*0.8},${-L*0.55} ${dir*7},0 Z`} fill={fill} />
      <path d={`M${dir*2.2},-3 C ${dir*2.6},${-L*0.5} ${arch*0.55},${-L*0.9} ${arch*0.96},${-L*0.97} C ${arch*1.05},${-L*0.9} ${arch*0.62},${-L*0.52} ${dir*4.6},-3 Z`} fill={stripe} opacity=".85" />
    </g>
  );
}
function PupRosette({ C, s = 1 }: { C: Palette; s?: number }) {
  return <g transform={`scale(${s})`}>{[-75,-40,-8,24,58,92,126,-110].map((a,i)=>(
    <path key={a} transform={`rotate(${a})`} d="M0,0 C2.4,-9 3.4,-16 1.1,-23 L-1.1,-23 C-3.4,-16 -2.4,-9 0,0 Z" fill={i%2? C.mid : C.dark} />))}</g>;
}
const SPIDER_ANGLES3 = [-72,-58,-46,-33,-21,-10,-2,7,16,27,39,50,63,75];
const SPIDER_ANGLES2 = [-56,-38,-22,-8,6,22,40,55];
const SPIDER_ANGLES1 = [-38,-16,2,20,38];
function Spider({ size, C, droop, yellowIdx, variegated }: { size: 1|2|3; C: Palette; droop: number; yellowIdx: number; variegated: boolean }) {
  const angles = size === 3 ? SPIDER_ANGLES3 : size === 2 ? SPIDER_ANGLES2 : SPIDER_ANGLES1;
  const stripe = variegated ? "#eef3e4" : C.pale;
  return (
    <g>
      {angles.map((a, i) => {
        const angle = a + droop * (a >= 0 ? 0.55 : -0.55);
        const len = (0.7 + 0.42 * Math.abs(Math.sin((i + 1) * 2.3))) * (size === 3 ? 1.18 : size === 2 ? 0.95 : 0.7);
        return <SpiderBlade key={i} angle={angle} len={len} C={C} stripe={stripe} fill={i === yellowIdx ? YELLOW : i % 2 ? C.mid : C.dark} />;
      })}
      {size === 3 && <>
        <path d="M-4,-10 C -40,-40 -74,-30 -84,10 C -88,26 -86,44 -88,58" stroke={C.mid} strokeWidth="2.4" fill="none" />
        <g transform="translate(-88,58) rotate(-155)"><PupRosette C={C} s={0.6} /></g>
        <path d="M6,-12 C 48,-40 84,-24 92,14" stroke={C.mid} strokeWidth="2.4" fill="none" />
        <g transform="translate(92,14) rotate(155)"><PupRosette C={C} s={0.55} /></g>
      </>}
    </g>
  );
}

export default function PlantVisual({ g, width = 260 }: { g: Pick<GardenState, "species"|"size"|"health"|"pot"|"trinket"|"variegation"|"bloom">; width?: number }) {
  const species: PlantSpecies = g.species ?? "pothos";
  const C = g.variegation === "golden" ? GOLDEN : GREENS;
  const droop = g.health === "thirsty" ? 16 : g.health === "okay" ? 7 : 0;
  const variegated = g.variegation === "variegated";
  const pot = potPaint(g.pot);
  const yellowIdx = g.health === "thirsty" ? (g.size === 3 ? 4 : 1) : -1;
  return (
    <svg viewBox="0 0 300 250" width={width} height={width * 0.83} aria-label="Your Inven(s)tory plant" role="img">
      <g transform="translate(150,172)">
        {species === "spider" && <Spider size={g.size} C={C} droop={droop} yellowIdx={yellowIdx} variegated={variegated} />}
        {species === "monstera" && <Monstera size={g.size} C={C} droop={droop} yellowIdx={yellowIdx} variegated={variegated} />}
        {species === "pothos" && <Pothos size={g.size} C={C} droop={droop} health={g.health} variegated={variegated} />}
        {g.bloom !== "none" && <Bloom kind={g.bloom} x={species === "spider" ? 36 : 22} y={-78} />}
      </g>
      <g transform="translate(150,172)">
        <path d="M-38,0 L38,0 L29,42 Q28,48 21,48 L-21,48 Q-28,48 -29,42 Z" fill={pot.fill} />
        <clipPath id={`potclip-${species}-${g.size}`}><path d="M-38,0 L38,0 L29,42 Q28,48 21,48 L-21,48 Q-28,48 -29,42 Z" /></clipPath>
        <g clipPath={`url(#potclip-${species}-${g.size})`}>{pot.extra}</g>
        <ellipse cx="0" cy="0" rx="36" ry="5" fill="#6b5138" opacity=".9" />
        <Trinket kind={g.trinket} />
      </g>
    </svg>
  );
}

// The Overhang: grows out of the plant's left side and over the layer cards —
// one vine/root straight down the left edge, one creeping along the TOP of the
// Layer I card (kept in its top padding band so no text is obscured).
export function Overhang({ species }: { species: PlantSpecies }) {
  const C = GREENS;
  return (
    <svg className="plant-overhang" viewBox="0 0 900 700" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
      {species === "pothos" && <g>
        {/* vine 1: straight down the left edge */}
        <path d="M56,0 C 44,60 60,130 48,210 C 40,290 58,370 48,470 C 42,560 54,620 48,690" stroke={C.mid} strokeWidth="2.6" fill="none" />
        {[{y:70,r:-70,s:.8},{y:150,r:-105,s:.72},{y:250,r:-75,s:.78},{y:340,r:-110,s:.66},{y:430,r:-80,s:.72},{y:530,r:-105,s:.6},{y:620,r:-85,s:.55}].map((l,i)=>(
          <g key={i} transform={`translate(${i%2?38:62},${l.y})`}><PothosLeaf C={C} fill={i%2? C.mid : C.dark} s={l.s} rot={l.r} /></g>
        ))}
        {/* vine 2: creeping along the top edge of the Layer I card */}
        <path d="M60,44 C 150,36 240,50 340,42 C 440,36 540,50 640,44" stroke={C.mid} strokeWidth="2.4" fill="none" />
        {[{x:140,r:150,s:.7},{x:250,r:-160,s:.62},{x:360,r:155,s:.68},{x:470,r:-155,s:.6},{x:580,r:150,s:.64}].map((l,i)=>(
          <g key={i} transform={`translate(${l.x},${i%2?34:52})`}><PothosLeaf C={C} fill={i%2? C.dark : C.mid} s={l.s} rot={l.r} /></g>
        ))}
      </g>}
      {species === "monstera" && <g stroke={ROOT} fill="none" opacity=".95">
        <path d="M52,0 C 40,80 58,170 46,270 C 38,370 56,470 46,560 C 42,620 50,660 46,700" strokeWidth="3.4" />
        <path d="M66,0 C 74,60 60,120 68,200 C 74,260 64,320 68,380" strokeWidth="2.6" />
        {/* root creeping between the filter row and the Layer I card top */}
        <path d="M60,40 C 160,48 260,36 370,44 C 480,52 570,40 660,46" strokeWidth="3" />
        <path d="M660,46 C 680,48 692,54 700,62" strokeWidth="2.4" />
      </g>}
      {species === "spider" && <g>
        {/* stolons arch over the filter buttons and rest pups on the Layer I edge */}
        <path d="M60,0 C 140,10 220,26 300,40" stroke={C.mid} strokeWidth="2.6" fill="none" />
        <g transform="translate(304,44)"><PupRosette C={C} s={.66} /></g>
        <path d="M56,4 C 180,24 340,30 500,42" stroke={C.mid} strokeWidth="2.2" fill="none" />
        <g transform="translate(505,46)"><PupRosette C={C} s={.56} /></g>
        {/* one stolon down the left edge */}
        <path d="M50,0 C 40,90 58,180 48,280 C 42,360 52,420 48,480" stroke={C.mid} strokeWidth="2.2" fill="none" />
        <g transform="translate(48,484)"><PupRosette C={C} s={.62} /></g>
      </g>}
    </svg>
  );
}
