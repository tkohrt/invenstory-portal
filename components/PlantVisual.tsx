"use client";
// The Inven(s)tory plant — parameterized SVG, referenced against real plant
// anatomy: spider plant = arching striped ribbon blades + stolons with pups;
// monstera = fenestrated leaves (edge slits + interior holes) on long petioles
// + air roots; pothos = mounding heart leaves + cascading vines. Size 3 is
// lush and spills over the pot; health adds droop / one yellow leaf only.
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

// ---------- species foliage ----------
// A spider-plant blade: arching tapered ribbon with a light center stripe.
function SpiderBlade({ angle, len, C, stripe, fill }: { angle: number; len: number; C: Palette; stripe: string; fill: string }) {
  const bend = angle > 0 ? 14 : -14; // arch direction follows fan side
  const L = 78 * len;
  return (
    <g transform={`rotate(${angle})`}>
      <path d={`M0,0 C ${bend*0.3},${-L*0.42} ${bend*0.9},${-L*0.78} ${bend},${-L} C ${bend*1.15},${-L*0.72} ${bend*0.55},${-L*0.38} 7,0 Z`} fill={fill} />
      <path d={`M2.4,-2 C ${bend*0.36},${-L*0.42} ${bend*0.92},${-L*0.76} ${bend},${-L*0.97} C ${bend*0.98},${-L*0.72} ${bend*0.5},${-L*0.4} 4.6,-2 Z`} fill={stripe} opacity=".85" />
    </g>
  );
}
function PupRosette({ C, s = 1 }: { C: Palette; s?: number }) {
  return <g transform={`scale(${s})`}>{[-70,-35,0,35,70,110,-110].map((a,i)=>(
    <path key={a} transform={`rotate(${a})`} d="M0,0 C2,-9 3,-16 1,-22 L-1,-22 C-3,-16 -2,-9 0,0 Z" fill={i%2? C.mid : C.dark} />))}</g>;
}
function Spider({ size, C, droop, yellowIdx, variegated }: { size: 1|2|3; C: Palette; droop: number; yellowIdx: number; variegated: boolean }) {
  const n = size === 3 ? 15 : size === 2 ? 9 : 5;
  const stripe = variegated ? "#eef3e4" : C.pale;
  const blades: ReactElement[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const spread = size === 3 ? 200 : size === 2 ? 150 : 110;   // size 3 spills past horizontal
    const base = -spread / 2 + t * spread;
    const angle = base + droop * (base >= 0 ? 1 : -1) * 0.8;
    const len = (0.72 + 0.5 * Math.abs(Math.sin((i + 1) * 2.1))) * (size === 3 ? 1.15 : size === 2 ? 0.95 : 0.7);
    blades.push(<SpiderBlade key={i} angle={angle} len={len} C={C} stripe={stripe} fill={i === yellowIdx ? YELLOW : i % 2 ? C.mid : C.dark} />);
  }
  return (
    <g>
      {blades}
      {size === 3 && <>
        {/* stolons arching out + down over the pot with pups */}
        <path d="M4,-8 C 52,-34 92,-16 100,26" stroke={C.mid} strokeWidth="2.6" fill="none" />
        <g transform="translate(100,26) rotate(160)"><PupRosette C={C} s={0.62} /></g>
        <path d="M-6,-6 C -50,-28 -84,-6 -90,34" stroke={C.mid} strokeWidth="2.4" fill="none" />
        <g transform="translate(-90,34) rotate(-160)"><PupRosette C={C} s={0.55} /></g>
      </>}
    </g>
  );
}

// Monstera leaf with edge slits + interior holes via evenodd.
function MonsteraLeaf({ C, fill, s, variegated }: { C: Palette; fill: string; s: number; variegated: boolean }) {
  return (
    <g transform={`scale(${s})`}>
      <path fillRule="evenodd" fill={fill} d="
        M0,16 C-24,12 -34,-6 -26,-24 C-18,-38 18,-38 26,-24 C34,-6 24,12 0,16 Z
        M-30,-8 L-10,-13 L-11,-9 Z
        M-29,-20 L-12,-22 L-13,-18 Z
        M30,-8 L10,-13 L11,-9 Z
        M29,-20 L12,-22 L13,-18 Z
        M-9,-26 a2.6,4.6 0 1 0 0.1,0 Z
        M8,-24 a2.2,4 0 1 0 0.1,0 Z
        M-2,-12 a2,3.4 0 1 0 0.1,0 Z" />
      <path d="M0,15 C0,4 0,-10 0,-30" stroke={C.dark} strokeWidth="1.6" opacity=".55" fill="none" />
      {variegated && <path d="M6,-18 C14,-20 20,-14 16,-6 C10,-2 4,-8 6,-18 Z" fill={C.pale} opacity=".9" />}
    </g>
  );
}
function Monstera({ size, C, droop, yellowIdx, variegated }: { size: 1|2|3; C: Palette; droop: number; yellowIdx: number; variegated: boolean }) {
  const defs: { a: number; petiole: number; s: number }[] =
    size === 3 ? [{a:-78,petiole:52,s:.95},{a:-48,petiole:70,s:1.12},{a:-18,petiole:84,s:1.28},{a:12,petiole:76,s:1.18},{a:42,petiole:62,s:1.05},{a:70,petiole:46,s:.9},{a:95,petiole:36,s:.75}]
    : size === 2 ? [{a:-58,petiole:48,s:.85},{a:-24,petiole:66,s:1.05},{a:10,petiole:58,s:.95},{a:44,petiole:44,s:.8},{a:74,petiole:32,s:.65}]
    : [{a:-38,petiole:38,s:.7},{a:2,petiole:50,s:.85},{a:40,petiole:34,s:.62}];
  return (
    <g>
      {size === 3 && <>{/* air roots over the pot edge */}
        <path d="M-8,0 C-26,10 -34,34 -30,62" stroke={ROOT} strokeWidth="2.8" fill="none" opacity=".9" />
        <path d="M6,2 C20,14 28,40 24,70" stroke={ROOT} strokeWidth="2.4" fill="none" opacity=".85" />
      </>}
      {defs.map((d, i) => {
        const a = d.a + droop * (d.a >= 0 ? 1 : -1) * 0.55;
        return (
          <g key={i} transform={`rotate(${a})`}>
            <path d={`M0,0 C1,${-d.petiole*0.4} -1,${-d.petiole*0.75} 0,${-d.petiole}`} stroke={C.dark} strokeWidth="2.6" fill="none" />
            <g transform={`translate(0,${-d.petiole - 8})`}>
              <MonsteraLeaf C={C} s={d.s * 0.9} variegated={variegated && i % 3 === 0} fill={i === yellowIdx ? YELLOW : i % 2 ? C.mid : C.dark} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

// Pothos: heart leaf helper + cascading vines.
function Heart({ C, fill, s, variegated }: { C: Palette; fill: string; s: number; variegated: boolean }) {
  return (
    <g transform={`scale(${s})`}>
      <path d="M0,13 C-13,5 -17,-8 -8,-14 C-3,-17 0,-14 0,-10 C0,-14 3,-17 8,-14 C17,-8 13,5 0,13 Z" fill={fill} />
      {variegated && <path d="M-3,3 C-8,-1 -9,-8 -4,-11 C-1,-12 0,-8 0,-6 C2,-10 6,-10 7,-6 C8,-1 3,4 -3,3 Z" fill={C.pale} opacity=".9" />}
      <path d="M0,12 C-1,4 -1,-4 0,-11" stroke={C.dark} strokeWidth="1" opacity=".4" fill="none" />
    </g>
  );
}
function PothosVine({ C, dir, len, droop, variegated, startYellow }: { C: Palette; dir: 1|-1; len: number; droop: number; variegated: boolean; startYellow?: boolean }) {
  // vine curve from pot rim outward+down; leaves alternate along it
  const pts = Array.from({ length: len }, (_, i) => {
    const t = (i + 1) / len;
    return { x: dir * (26 + 46 * t + 8 * Math.sin(t * 5)), y: -4 + (58 + droop * 1.6) * t * t + 18 * t, s: 1 - 0.45 * t };
  });
  const path = `M${dir * 18},-6 ` + pts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <g>
      <path d={path.replace(/L/g, " L")} stroke={C.mid} strokeWidth="2" fill="none" opacity=".9" />
      {pts.map((p, i) => (
        <g key={i} transform={`translate(${p.x},${p.y}) rotate(${dir * (20 + i * 14) + droop})`}>
          <Heart C={C} s={0.8 * p.s} variegated={variegated && i % 2 === 0} fill={startYellow && i === 0 ? YELLOW : i % 2 ? C.mid : C.dark} />
        </g>
      ))}
    </g>
  );
}
function Pothos({ size, C, droop, health, variegated }: { size: 1|2|3; C: Palette; droop: number; health: string; variegated: boolean }) {
  const mound = size === 3 ? 9 : size === 2 ? 7 : 4;
  return (
    <g>
      {Array.from({ length: mound }, (_, i) => {
        const t = i / (mound - 1);
        const a = (-64 + t * 128) * (1 + droop / 40);
        const s = 0.85 + 0.3 * Math.abs(Math.sin((i + 1) * 1.9));
        return (
          <g key={i} transform={`rotate(${a}) translate(0,${-26 * s})`}>
            <Heart C={C} s={s} variegated={variegated && i % 3 === 0} fill={health === "thirsty" && i === mound - 1 ? YELLOW : i % 2 ? C.mid : C.dark} />
            <path d="M0,12 L0,26" stroke={C.dark} strokeWidth="1.6" />
          </g>
        );
      })}
      {size >= 2 && <PothosVine C={C} dir={1} len={size === 3 ? 5 : 3} droop={droop} variegated={variegated} />}
      {size === 3 && <PothosVine C={C} dir={-1} len={4} droop={droop} variegated={variegated} startYellow={health === "thirsty"} />}
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
    <svg viewBox="0 0 300 240" width={width} height={width * 0.8} aria-label="Your Inven(s)tory plant" role="img">
      <g transform="translate(150,168)">
        {species === "spider" && <Spider size={g.size} C={C} droop={droop} yellowIdx={yellowIdx} variegated={variegated} />}
        {species === "monstera" && <Monstera size={g.size} C={C} droop={droop} yellowIdx={yellowIdx} variegated={variegated} />}
        {species === "pothos" && <Pothos size={g.size} C={C} droop={droop} health={g.health} variegated={variegated} />}
        {g.bloom !== "none" && <Bloom kind={g.bloom} x={species === "spider" ? 34 : 20} y={-70} />}
      </g>
      <g transform="translate(150,168)">
        <path d="M-38,0 L38,0 L29,42 Q28,48 21,48 L-21,48 Q-28,48 -29,42 Z" fill={pot.fill} />
        <clipPath id={`potclip-${species}-${g.size}`}><path d="M-38,0 L38,0 L29,42 Q28,48 21,48 L-21,48 Q-28,48 -29,42 Z" /></clipPath>
        <g clipPath={`url(#potclip-${species}-${g.size})`}>{pot.extra}</g>
        <ellipse cx="0" cy="0" rx="36" ry="5" fill="#6b5138" opacity=".9" />
        <Trinket kind={g.trinket} />
      </g>
    </svg>
  );
}

// Size-3 THRIVING flourish: hanging elements that visually continue the plant
// down into the Inven(s)tory layers (rendered behind content, left side).
export function Tendrils({ species }: { species: PlantSpecies }) {
  const C = GREENS;
  return (
    <svg className="garden-tendrils" viewBox="0 0 110 640" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      {species === "monstera" && <g stroke={ROOT} strokeWidth="3.4" fill="none" opacity=".95">
        <path d="M40,0 C30,90 52,170 40,280 C32,370 50,460 42,620" />
        <path d="M66,0 C74,110 58,220 70,330 C78,430 62,520 68,640" strokeWidth="2.8" />
        <path d="M52,0 C50,60 54,120 50,190" strokeWidth="2.2" />
      </g>}
      {species === "pothos" && <g>
        <path d="M52,0 C30,80 78,150 46,240 C22,320 76,390 48,480 C34,545 60,590 52,640" stroke={C.mid} strokeWidth="3" fill="none" />
        {[62,140,225,310,395,475,555].map((y,i)=>(
          <g key={y} transform={`translate(${i%2? 70:32},${y}) rotate(${i%2? 38:-38}) scale(${1.05 - i*0.06})`}>
            <path d="M0,13 C-13,5 -17,-8 -8,-14 C-3,-17 0,-14 0,-10 C0,-14 3,-17 8,-14 C17,-8 13,5 0,13 Z" fill={i%2? C.mid : C.dark} />
          </g>
        ))}
      </g>}
      {species === "spider" && <g>
        <path d="M48,0 C58,110 38,220 52,330" stroke={C.mid} strokeWidth="2.8" fill="none" />
        <path d="M60,0 C50,150 70,280 56,430 C50,490 60,540 56,580" stroke={C.mid} strokeWidth="2.4" fill="none" />
        {[{x:52,y:330,s:1},{x:56,y:430,s:.85},{x:56,y:580,s:.9}].map((p,i)=>(
          <g key={i} transform={`translate(${p.x},${p.y}) scale(${p.s})`}>
            {[-80,-45,-10,25,60,95,130,165,-115].map((a,j)=>(
              <path key={a} transform={`rotate(${a})`} d="M0,0 C2.6,-10 3.6,-18 1.2,-25 L-1.2,-25 C-3.6,-18 -2.6,-10 0,0 Z" fill={j%2? C.mid : C.dark} />
            ))}
          </g>
        ))}
      </g>}
    </svg>
  );
}
