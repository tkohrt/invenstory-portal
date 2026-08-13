"use client";
// The Inven(s)tory plant — pure parameterized SVG, no image assets.
// Flat 2-tone style; size = growth, droop/yellow = freshness (never dead).
import type { ReactElement } from "react";
import type { GardenState, PlantSpecies } from "@/lib/types";

const GREENS = { dark: "#4e7a4e", mid: "#6b9b6b", light: "#8fb98f" };
const GOLDEN = { dark: "#9b8a3a", mid: "#b7a34c", light: "#cfc07a" };
const YELLOW = "#c9b458";

function potPaint(pot: string): { fill: string; extra?: ReactElement } {
  switch (pot) {
    case "glazed": return { fill: "#4e7a9b", extra: <rect x="-26" y="4" width="52" height="5" rx="2" fill="#7fa6c4" /> };
    case "mosaic": return { fill: "#8a6d5c", extra: <g>{[-20,-8,4,16].map((x,i)=><rect key={i} x={x} y={8+(i%2)*8} width="7" height="7" rx="1" fill={["#c94f4f","#4e7a9b","#d9a441","#6b9b6b"][i]} />)}</g> };
    case "talavera": return { fill: "#f2ede4", extra: <g>{[-18,-4,10].map((x,i)=><circle key={i} cx={x+3} cy={14} r="3.4" fill="#2f5d9b" />)}<path d="M-26,6 H26" stroke="#2f5d9b" strokeWidth="2"/></g> };
    case "porcelain": return { fill: "#f7f7f4", extra: <path d="M-24,14 q6,-6 12,0 t12,0 t12,0" stroke="#3a6ea8" strokeWidth="2" fill="none" /> };
    case "jade": return { fill: "#7fa88b", extra: <rect x="-26" y="4" width="52" height="3" rx="1.5" fill="#a4c4ab" /> };
    case "raku": return { fill: "#4a4038", extra: <path d="M-14,2 q4,14 -2,26" stroke="#b87a4b" strokeWidth="2.5" fill="none" opacity=".8" /> };
    default: return { fill: "#c1704f", extra: <rect x="-28" y="0" width="56" height="6" rx="2" fill="#a85c3f" /> };
  }
}

function Trinket({ kind }: { kind: string | null }) {
  if (!kind) return null;
  if (kind === "gnome") return <g transform="translate(20,104)"><ellipse cx="0" cy="12" rx="5" ry="6" fill="#e8e2d4" /><path d="M-5,8 L0,-6 L5,8 Z" fill="#c94f4f" /><circle cx="0" cy="8" r="2.6" fill="#e8b89b" /></g>;
  if (kind === "mushroom") return <g transform="translate(-24,108)"><rect x="-2" y="0" width="4" height="8" rx="1.6" fill="#e8e2d4" /><path d="M-7,2 a7,5 0 0 1 14,0 Z" fill="#c94f4f" /><circle cx="-2.5" cy="-1" r="1" fill="#fff" /><circle cx="2.5" cy="0" r="1" fill="#fff" /></g>;
  if (kind === "crane") return <g transform="translate(23,102)" fill="#8b8b8b"><path d="M0,14 L0,4 Q0,0 4,-2 Q8,-3 8,-6 Q8,-9 5,-9 Q9,-10 10,-6 Q10,-2 6,0 Q2,2 2,6 L2,14 Z" /></g>;
  if (kind === "funded_flag") return <g transform="translate(-22,96)"><rect x="0" y="0" width="1.6" height="22" fill="#8a7a54" /><path d="M1.6,1 h16 l-4,4 4,4 h-16 Z" fill="#d9b943" /><text x="4" y="7.4" fontSize="4.6" fontWeight="700" fill="#5c4d1e">WON</text></g>;
  return <g transform="translate(-22,96)"><rect x="0" y="0" width="1.6" height="22" fill="#8a7a54" /><rect x="1.6" y="1" width="15" height="9" rx="1.5" fill="#1a1a1a" /><text x="4" y="7.8" fontSize="5.4" fontWeight="700" fill="#fff">FG</text></g>;
}

function Bloom({ kind, x, y }: { kind: "bud" | "flower"; x: number; y: number }) {
  if (kind === "bud") return <g transform={`translate(${x},${y})`}><circle r="3.4" fill="#d98aa8" /><circle r="1.6" fill="#e8b3c8" /></g>;
  return <g transform={`translate(${x},${y})`}>{[0,72,144,216,288].map(a=><ellipse key={a} cx="0" cy="-4" rx="2.6" ry="4.4" fill="#e39ab5" transform={`rotate(${a})`} />)}<circle r="2.4" fill="#e8cf6a" /></g>;
}

export default function PlantVisual({ g, width = 200 }: { g: Pick<GardenState, "species"|"size"|"health"|"pot"|"trinket"|"variegation"|"bloom">; width?: number }) {
  const species: PlantSpecies = g.species ?? "pothos";
  const C = g.variegation === "golden" ? GOLDEN : GREENS;
  const droop = g.health === "thirsty" ? 14 : g.health === "okay" ? 6 : 0;
  const nLeaves = g.size === 3 ? 8 : g.size === 2 ? 6 : 3;
  const scale = g.size === 3 ? 1 : g.size === 2 ? 0.85 : 0.68;
  const pot = potPaint(g.pot);
  const leaves: ReactElement[] = [];

  for (let i = 0; i < nLeaves; i++) {
    const t = i / (nLeaves - 1);
    const baseAngle = -80 + t * 160;                    // fan across the pot
    const angle = baseAngle + droop * (baseAngle >= 0 ? 1 : -1) * 0.9;
    const len = (0.75 + 0.5 * Math.abs(Math.sin((i + 1) * 2.4))) * scale;
    const yellow = g.health === "thirsty" && i === nLeaves - 1;
    const fill = yellow ? YELLOW : i % 2 ? C.mid : C.dark;
    const varg = g.variegation === "variegated" && !yellow && i % 3 === 0;
    if (species === "monstera") {
      leaves.push(
        <g key={i} transform={`rotate(${angle * 0.62}) translate(0,${-30 * len}) scale(${0.9 * len})`}>
          <path d="M0,10 C-16,6 -22,-8 -14,-20 C-8,-29 8,-29 14,-20 C22,-8 16,6 0,10 Z M-9,-19 L-4,-6 L-8,-4 Z M9,-19 L4,-6 L8,-4 Z" fillRule="evenodd" fill={fill} />
          {varg && <path d="M-6,-14 C-2,-18 3,-17 5,-12 C3,-8 -3,-8 -6,-14 Z" fill={C.light} />}
          <path d="M0,10 L0,26" stroke={C.dark} strokeWidth="2.2" />
        </g>);
    } else if (species === "spider") {
      leaves.push(
        <g key={i} transform={`rotate(${angle * 0.85})`}>
          <path d={`M0,0 C ${4*len},${-26*len} ${6*len},${-44*len} ${2*len},${-58*len} C ${1*len},${-60*len} ${-1*len},${-60*len} ${-2*len},${-58*len} C ${-6*len},${-44*len} ${-4*len},${-26*len} 0,0 Z`} fill={fill} />
          {varg && <path d={`M0,${-8*len} C ${1.4*len},${-24*len} ${1.6*len},${-40*len} ${0.6*len},${-52*len} L ${-0.6*len},${-52*len} C ${-1.6*len},${-40*len} ${-1.4*len},${-24*len} 0,${-8*len} Z`} fill={C.light} />}
        </g>);
    } else { // pothos — heart leaves on short vines
      leaves.push(
        <g key={i} transform={`rotate(${angle * 0.7}) translate(0,${-26 * len}) scale(${0.85 * len})`}>
          <path d="M0,12 C-12,4 -16,-8 -8,-14 C-3,-17 0,-14 0,-10 C0,-14 3,-17 8,-14 C16,-8 12,4 0,12 Z" fill={fill} />
          {varg && <path d="M-2,2 C-6,-2 -7,-8 -3,-10 C0,-11 0,-7 0,-5 C2,-9 5,-9 6,-6 C7,-2 3,2 -2,2 Z" fill={C.light} />}
          <path d="M0,12 L0,24" stroke={C.dark} strokeWidth="1.8" />
        </g>);
    }
  }

  return (
    <svg viewBox="0 0 220 170" width={width} height={width * 0.77} aria-label="Your Inven(s)tory plant" role="img">
      <g transform="translate(110,122)">
        <g>{leaves}</g>
        {g.bloom !== "none" && <Bloom kind={g.bloom} x={species === "spider" ? 26 : 14} y={-40 * scale - 8} />}
      </g>
      {/* pot */}
      <g transform="translate(110,122)">
        <path d="M-30,0 L30,0 L23,34 Q22,38 17,38 L-17,38 Q-22,38 -23,34 Z" fill={pot.fill} />
        <g clipPath="url(#potclip)">{pot.extra}</g>
        <clipPath id="potclip"><path d="M-30,0 L30,0 L23,34 Q22,38 17,38 L-17,38 Q-22,38 -23,34 Z" /></clipPath>
        <Trinket kind={g.trinket} />
      </g>
    </svg>
  );
}

// Size-3 flourish: species tendrils extending down the page background.
export function Tendrils({ species }: { species: PlantSpecies }) {
  const stroke = GREENS.mid;
  return (
    <svg className="garden-tendrils" viewBox="0 0 60 600" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      {species === "monstera" && <g stroke="#9b8468" strokeWidth="2.4" fill="none" opacity=".9">
        <path d="M22,0 C18,90 30,160 24,260 C20,340 30,420 26,560" />
        <path d="M38,0 C42,110 32,220 40,330 C44,420 36,500 40,600" />
      </g>}
      {species === "pothos" && <g>
        <path d="M30,0 C14,80 46,140 26,230 C10,310 44,380 28,470 C18,530 34,570 30,600" stroke={stroke} strokeWidth="2.2" fill="none" />
        {[70,150,240,330,420,510].map((y,i)=>(
          <path key={y} transform={`translate(${i%2? 40:16},${y}) rotate(${i%2? 35:-35}) scale(.8)`}
            d="M0,10 C-10,3 -13,-7 -7,-12 C-3,-14 0,-12 0,-9 C0,-12 3,-14 7,-12 C13,-7 10,3 0,10 Z" fill={GREENS.mid} />
        ))}
      </g>}
      {species === "spider" && <g>
        <path d="M28,0 C34,100 22,200 30,300" stroke={stroke} strokeWidth="1.8" fill="none" />
        <path d="M34,0 C28,140 40,260 32,420" stroke={stroke} strokeWidth="1.6" fill="none" />
        {[300,420].map((y,i)=>(
          <g key={y} transform={`translate(${i? 32:30},${y})`}>
            {[-60,-20,20,60,100,140,180,220].map(a=>(
              <path key={a} transform={`rotate(${a})`} d="M0,0 C2,-8 3,-14 1,-19 L-1,-19 C-3,-14 -2,-8 0,0 Z" fill={GREENS.mid} />
            ))}
          </g>
        ))}
      </g>}
    </svg>
  );
}
