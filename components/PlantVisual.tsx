"use client";
// The Inven(s)tory plant — production port of the approved Style B mockup
// (Tyler-approved 2026-08-15 after 16 revision passes against his sketches).
// Parameterized: species x size(1-3) x health x variegation x pot x trinket x bloom.
import type { ReactElement } from "react";
import type { GardenState, PlantSpecies } from "@/lib/types";

const GREENS = { deep: "#2e5233", dark: "#3f6b42", mid: "#5c8f5e", light: "#8fbc8f", pale: "#d4e6c8" };
const GOLDEN = { deep: "#6e6128", dark: "#8a7a34", mid: "#ab9847", light: "#cbbd72", pale: "#e8e0b8" };
const YELLOW = "#c9b458";
const ROOT = "#a08363";
const SOIL = "#5c4632";
type Palette = typeof GREENS;

// ---------- pots (approved rounded shape; 7 skins) ----------
const POT_STYLES: Record<string, { body: string; rim: string; hi: string; extra?: (rx: number) => ReactElement }> = {
  terracotta: { body: "#bd6c4b", rim: "#a05539", hi: "#d08d6e" },
  glazed: { body: "#4e7a9b", rim: "#3d6382", hi: "#9fc0d8", extra: rx => <rect x={-rx + 3} y={9} width={2 * rx - 6} height={5} rx={2.5} fill="#7fa6c4" /> },
  mosaic: { body: "#8a6d5c", rim: "#6f574a", hi: "#b39a89", extra: () => <g>{[-20, -8, 4, 16].map((x, i) => <rect key={i} x={x} y={11 + (i % 2) * 9} width={8} height={8} rx={1.5} fill={["#c94f4f", "#4e7a9b", "#d9a441", "#5c8f5e"][i]} />)}</g> },
  talavera: { body: "#f2ede4", rim: "#d9d2c2", hi: "#ffffff", extra: () => <g>{[-18, -2, 14].map((x, i) => <circle key={i} cx={x + 3} cy={17} r={3.8} fill="#2f5d9b" />)}<path d="M-22,10 H22" stroke="#2f5d9b" strokeWidth="2" /></g> },
  porcelain: { body: "#f7f7f4", rim: "#dedede", hi: "#ffffff", extra: () => <path d="M-20,17 q7,-7 14,0 t14,0" stroke="#3a6ea8" strokeWidth="2.2" fill="none" /> },
  jade: { body: "#7fa88b", rim: "#64876f", hi: "#b9d3bd", extra: rx => <rect x={-rx + 3} y={9} width={2 * rx - 6} height={3.5} rx={1.75} fill="#a4c4ab" /> },
  raku: { body: "#4a4038", rim: "#322b25", hi: "#8a7a6b", extra: () => <path d="M-14,9 q5,14 -2,24" stroke="#b87a4b" strokeWidth="2.8" fill="none" opacity=".85" /> },
};

function Pot({ rx, kind }: { rx: number; kind: string }) {
  const h = Math.round(rx * 1.3);
  const st = POT_STYLES[kind] ?? POT_STYLES.terracotta;
  return (
    <g>
      <ellipse cx={2} cy={h + 6} rx={rx * 1.5} ry={6} fill="#000" opacity=".08" />
      <path d={`M${-rx + 5},0 L${rx - 5},0 Q${rx},0 ${rx - 0.9},4 L${rx * 0.75},${h} Q${rx * 0.71},${h + 5} ${rx * 0.54},${h + 5} L${-rx * 0.54},${h + 5} Q${-rx * 0.71},${h + 5} ${-rx * 0.75},${h} L${-rx + 0.9},4 Q${-rx},0 ${-rx + 5},0 Z`} fill={st.body} />
      {st.extra && <g clipPath="url(#potbody)">{st.extra(rx)}</g>}
      <clipPath id="potbody"><path d={`M${-rx + 5},0 L${rx - 5},0 Q${rx},0 ${rx - 0.9},4 L${rx * 0.75},${h} Q${rx * 0.71},${h + 5} ${rx * 0.54},${h + 5} L${-rx * 0.54},${h + 5} Q${-rx * 0.71},${h + 5} ${-rx * 0.75},${h} L${-rx + 0.9},4 Q${-rx},0 ${-rx + 5},0 Z`} /></clipPath>
      <path d={`M${-rx},6 L${-rx},5 Q${-rx},0 ${-rx + 5},0 L${rx - 5},0 Q${rx},0 ${rx},5 L${rx},6 Z`} fill={st.rim} />
      <path d={`M${-rx * 0.8},9 Q${-rx * 0.7},${h * 0.55} ${-rx * 0.6},${h - 2}`} stroke={st.hi} strokeWidth="3" fill="none" opacity=".55" strokeLinecap="round" />
      <ellipse cx={0} cy={0} rx={rx - 3} ry={4} fill={SOIL} />
    </g>
  );
}

function Trinket({ kind }: { kind: string | null }) {
  if (!kind) return null;
  if (kind === "gnome") return <g transform="translate(19,12)"><ellipse cx="0" cy="12" rx="5.4" ry="6.4" fill="#e8e2d4" /><path d="M-5.4,7.5 L0,-6.5 L5.4,7.5 Z" fill="#c94f4f" /><circle cx="0" cy="8" r="2.7" fill="#e8b89b" /></g>;
  if (kind === "mushroom") return <g transform="translate(-20,16)"><rect x="-2.2" y="0" width="4.4" height="8" rx="1.8" fill="#e8e2d4" /><path d="M-7,2 a7,5.4 0 0 1 14,0 Z" fill="#c94f4f" /><circle cx="-2.6" cy="-0.8" r="1.1" fill="#fff" /><circle cx="2.6" cy="0" r="1.1" fill="#fff" /></g>;
  if (kind === "crane") return <g transform="translate(21,9)" fill="#8b8b8b"><path d="M0,15 L0,4.5 Q0,0 4.5,-1.8 Q9,-3.6 9,-7 Q9,-10 5.4,-10 Q9.9,-11 10.8,-6.3 Q10.8,-1.8 6.3,0 Q1.8,1.8 1.8,6.3 L1.8,15 Z" /></g>;
  if (kind === "funded_flag") return <g transform="translate(-21,4)"><rect x="0" y="0" width="1.8" height="23" fill="#8a7a54" /><path d="M1.8,1 h17 l-4.5,4.5 4.5,4.5 h-17 Z" fill="#d9b943" /><text x="4.4" y="7.8" fontSize="4.8" fontWeight="700" fill="#5c4d1e">WON</text></g>;
  return <g transform="translate(-21,4)"><rect x="0" y="0" width="1.8" height="23" fill="#8a7a54" /><rect x="1.8" y="1" width="15" height="9" rx="1.8" fill="#1a1a1a" /><text x="4.4" y="8" fontSize="5.4" fontWeight="700" fill="#fff">FG</text></g>;
}

function Bloom({ kind, x, y }: { kind: "bud" | "flower"; x: number; y: number }) {
  if (kind === "bud") return <g transform={`translate(${x},${y})`}><path d="M0,6 Q-4,0 0,-5 Q4,0 0,6 Z" fill="#d98aa8" /><circle cy="-4" r="1.8" fill="#e8b3c8" /></g>;
  return <g transform={`translate(${x},${y})`}>{[0, 72, 144, 216, 288].map(a => <ellipse key={a} cx="0" cy="-5" rx="3" ry="5.4" fill="#e39ab5" transform={`rotate(${a})`} />)}<circle r="2.8" fill="#e8cf6a" /></g>;
}

// ---------- shared leaf pieces ----------
const HEART = "M0,16 C-11,7 -16,-6 -8,-12 C-3,-15 0,-12 0,-8 C0,-12 3,-15 8,-12 C16,-6 11,7 0,16 Z";
function Heart({ C, fill, varg }: { C: Palette; fill: string; varg?: boolean }) {
  return (
    <g>
      <path d={HEART} fill={fill} />
      {varg && <path d="M-3,3 C-7,-1 -8,-7 -4,-10 C-1,-11 0,-7 0,-5 C2,-9 5,-9 6,-6 C7,-2 3,4 -3,3 Z" fill={C.pale} opacity=".9" />}
      <path d="M0,12 C-1,4 -1,-4 0,-11" stroke={C.deep} strokeWidth="1" opacity=".5" fill="none" />
      {[[-3, 4, -7, -4], [3, 4, 7, -4]].map((v, i) => <path key={i} d={`M0,${v[1]} Q ${v[0] * 1.6},${v[1] - 2} ${v[2]},${v[3]}`} stroke={C.deep} strokeWidth=".55" opacity=".45" fill="none" />)}
    </g>
  );
}
function Shadowed({ C, children, shadow }: { C: Palette; children: ReactElement; shadow: ReactElement }) {
  return <g><g transform="translate(1.4,1.8)">{shadow}</g>{children}</g>;
}
function PothosLeafStem({ x, y, rot, s, C }: { x: number; y: number; rot: number; s: number; C: Palette }) {
  return <g transform={`translate(${x},${y}) rotate(${rot})`}><path d="M0,0 C 1,2.5 0.5,4.5 0,7" stroke={C.dark} strokeWidth={1.4 * s} fill="none" transform="scale(1,-1)" /></g>;
}
function PothosLeafBlade({ x, y, rot, s, C, fill, varg }: { x: number; y: number; rot: number; s: number; C: Palette; fill: string; varg?: boolean }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${rot})`}>
      <g transform={`translate(0,${-16 * s}) scale(${s})`}>
        <Shadowed C={C} shadow={<path d={HEART} fill={C.deep} />}><Heart C={C} fill={fill} varg={varg} /></Shadowed>
      </g>
    </g>
  );
}
function VineLeafStem({ vx, vy, side, s, C }: { vx: number; vy: number; side: number; s: number; C: Palette }) {
  return <g transform={`translate(${vx},${vy})`}><path d={`M0,0 C ${side * 3},1.5 ${side * 4.5},4 ${side * 4},7`} stroke={C.dark} strokeWidth={1.3 * s} fill="none" /></g>;
}
function VineLeafBlade({ vx, vy, side, tilt, s, C, fill, varg }: { vx: number; vy: number; side: number; tilt: number; s: number; C: Palette; fill: string; varg?: boolean }) {
  return (
    <g transform={`translate(${vx},${vy})`}>
      <g transform={`translate(${side * 4},${7 + 12 * s}) rotate(${tilt}) scale(${s})`}>
        <Shadowed C={C} shadow={<path d={HEART} fill={C.deep} />}><Heart C={C} fill={fill} varg={varg} /></Shadowed>
      </g>
    </g>
  );
}

// ---------- POTHOS ----------
const BACK_CROWN: [number, number, number, number][] = [[-17, 5, -44, .82], [-7, -5, -14, .92], [4, -2, 9, .78], [14, 1, 48, .86], [-1, -9, -4, 1.0]];
const FRONT_CROWN: [number, number, number, number, keyof Palette][] = [[-13, 10, -64, .68, "mid"], [10, 7, 55, .79, "light"], [-4, 3, -24, .95, "light"], [6, 1, 31, .7, "mid"], [2, 12, 7, .84, "mid"], [16, 11, 72, .5, "light"]];
const LEFT_VINE: [number, number, number, number, number, keyof Palette][] = [[-31, 18, -1, -8, .82, "mid"], [-35, 44, 1, 10, .74, "light"], [-33, 78, -1, -12, .66, "mid"], [-33, 102, 1, 8, .6, "light"], [-33, 128, -1, -5, .54, "mid"]];
const RIGHT_VINE: [number, number, number, number, number, keyof Palette][] = [[31, 20, 1, 10, .84, "mid"], [39, 54, -1, -8, .76, "light"], [38, 88, 1, 12, .68, "mid"], [36, 120, -1, -9, .62, "light"], [37, 152, 1, 8, .56, "mid"], [36, 184, -1, -4, .5, "light"]];
const FACE_VINE: [number, number, number, number, number, keyof Palette][] = [[3, 16, 1, 6, .66, "mid"], [1, 32, -1, -8, .58, "light"], [2, 48, 1, 4, .5, "mid"]];

function Pothos({ size, C, droop, thirsty, varg }: { size: 1 | 2 | 3; C: Palette; droop: number; thirsty: boolean; varg: boolean }) {
  const shrink = size === 1 ? 0.82 : size === 2 ? 0.92 : 1;
  const stems: ReactElement[] = []; const leaves: ReactElement[] = [];
  let k = 0;
  const addP = (x: number, y: number, rot: number, s: number, fill: string, v?: boolean) => {
    stems.push(<PothosLeafStem key={`ps${k}`} x={x} y={y} rot={rot} s={s} C={C} />);
    leaves.push(<PothosLeafBlade key={`pl${k++}`} x={x} y={y} rot={rot} s={s} C={C} fill={fill} varg={v} />);
  };
  const addV = (vx: number, vy: number, side: number, tilt: number, s: number, fill: string, v?: boolean) => {
    stems.push(<VineLeafStem key={`vs${k}`} vx={vx} vy={vy} side={side} s={s} C={C} />);
    leaves.push(<VineLeafBlade key={`vl${k++}`} vx={vx} vy={vy} side={side} tilt={tilt + droop * side * 0.6} s={s} C={C} fill={fill} varg={v} />);
  };
  if (size === 3) {
    stems.push(<path key="v1" d="M-22,-4 C -34,10 -37,42 -33,72 C -31,96 -35,114 -33,128" stroke={C.mid} strokeWidth="2" fill="none" />);
    stems.push(<path key="v2" d="M22,-6 C 36,12 41,52 37,92 C 34,128 39,158 36,184" stroke={C.mid} strokeWidth="2" fill="none" />);
    stems.push(<path key="v3" d="M2,-2 C 4,14 0,28 2,50" stroke={C.mid} strokeWidth="1.8" fill="none" />);
  } else if (size === 2) {
    stems.push(<path key="v1" d="M-22,-4 C -34,10 -37,42 -33,72" stroke={C.mid} strokeWidth="2" fill="none" />);
    stems.push(<path key="v2" d="M22,-6 C 36,12 41,52 37,92" stroke={C.mid} strokeWidth="2" fill="none" />);
  }
  (size === 1 ? [BACK_CROWN[1], BACK_CROWN[2], BACK_CROWN[4]] : BACK_CROWN).forEach(L => addP(L[0], L[1], L[2], L[3], C.dark));
  if (size === 3) {
    LEFT_VINE.forEach((L, i) => addV(L[0], L[1], L[2], L[3], L[4], C[L[5]], varg && i % 2 === 0));
    RIGHT_VINE.forEach((L, i) => addV(L[0], L[1], L[2], L[3], L[4], C[L[5]], varg && i % 2 === 1));
    FACE_VINE.forEach(L => addV(L[0], L[1], L[2], L[3], L[4], C[L[5]]));
  } else if (size === 2) {
    LEFT_VINE.slice(0, 2).forEach(L => addV(L[0], L[1], L[2], L[3], L[4], C[L[5]], varg));
    RIGHT_VINE.slice(0, 3).forEach(L => addV(L[0], L[1], L[2], L[3], L[4], C[L[5]]));
  }
  (size === 1 ? [FRONT_CROWN[2], FRONT_CROWN[3], FRONT_CROWN[4]] : FRONT_CROWN).forEach((L, i) =>
    addP(L[0], L[1], L[2], L[3], thirsty && i === 1 ? YELLOW : C[L[4]], varg && i === 0));
  if (size >= 2) { addV(-8, 3, -1, -9, .6, C.light); addV(11, 3, 1, 11, .55, C.mid); }
  addP(-6, -13, -8, .88, C.mid);
  if (size >= 2) addP(10, -10, 24, .78, C.light);
  return <g transform={`scale(${shrink})`}>{stems}{leaves}</g>;
}

// ---------- MONSTERA ----------
const MON_LEAF_PATH = `M0,-14 C-4,-18 -10,-20 -16,-17 C-29,-12 -35,1 -31,13 C-26,25 -13,35 0,40 C13,35 26,25 31,13 C35,1 29,-12 16,-17 C10,-20 4,-18 0,-14 Z
 M-6,7 C-12,11 -18,17 -20,25 C-16,25 -9,17 -4,10 Z
 M-5,-6 C-12,-3 -19,2 -22,8 C-18,9 -11,3 -3,-3 Z
 M6,7 C12,11 18,17 20,25 C16,25 9,17 4,10 Z
 M5,-6 C12,-3 19,2 22,8 C18,9 11,3 3,-3 Z
 M-2,22 C-3,28 -2,31 0,34 C2,31 3,28 2,22 Z`;
const HEART_BIG = "M0,16 C-16,8 -22,-8 -11,-16 C-4,-20 0,-16 0,-11 C0,-16 4,-20 11,-16 C22,-8 16,8 0,16 Z";
function MonLeaf({ x, y, rot, s, C, fill, solid, varg }: { x: number; y: number; rot: number; s: number; C: Palette; fill: string; solid?: boolean; varg?: boolean }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${rot}) scale(${s * 1.02},${s * 0.92})`}>
      <path d={solid ? HEART_BIG : MON_LEAF_PATH} fillRule="evenodd" fill={fill} />
      <path d="M0,-13 C-1,-4 -1,8 0,19" stroke={C.deep} strokeWidth="1.3" opacity=".55" fill="none" />
      {varg && !solid && <path d="M8,14 C15,12 20,18 16,26 C11,29 6,23 8,14 Z" fill={C.pale} opacity=".9" />}
    </g>
  );
}
const MON_STEMS: [string, number, number, number, number, keyof Palette, boolean][] = [
  ["M-4,0 C -10,-30 -30,-52 -50,-76", -55, -92, 18, 1.45, "mid", false],
  ["M0,0 C 2,-40 -4,-72 -10,-96", -11, -112, -4, 1.25, "dark", false],
  ["M4,0 C 14,-28 36,-46 54,-60", 59, -78, -22, 1.3, "light", false],
  ["M2,0 C 6,-22 8,-34 10,-48", 11, -60, 4, 0.9, "deep", true],
  ["M6,0 C 20,-8 36,-6 48,4", 55, 10, -30, 1.0, "deep", false],
];
function Monstera({ size, C, droop, thirsty, varg }: { size: 1 | 2 | 3; C: Palette; droop: number; thirsty: boolean; varg: boolean }) {
  const shrink = size === 1 ? 0.72 : size === 2 ? 0.88 : 1;
  const pick = size === 1 ? [1, 0, 3] : size === 2 ? [1, 0, 2, 3] : [0, 1, 2, 3, 4];
  return (
    <g transform={`scale(${shrink})`}>
      {size === 3 && <>
        <path d="M6,0 C 18,8 26,20 28,38 C 30,62 24,86 25,108 C 26,120 29,128 33,134" stroke={ROOT} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M25,108 C 23,120 20,128 20,136" stroke={ROOT} strokeWidth="1.9" fill="none" strokeLinecap="round" />
        <path d="M-8,2 C -18,10 -22,22 -22,40 C -22,54 -20,64 -21,74" stroke={ROOT} strokeWidth="2.4" fill="none" opacity=".9" strokeLinecap="round" />
      </>}
      {pick.map((i, n) => {
        const st = MON_STEMS[i];
        const dd = droop * 0.5 * (st[1] >= 0 ? 1 : -1);
        return (
          <g key={i} transform={`rotate(${dd})`}>
            <path d={st[0]} stroke={C.deep} strokeWidth="3" fill="none" strokeLinecap="round" />
            <MonLeaf x={st[1]} y={st[2]} rot={st[3]} s={st[4]} C={C} solid={st[6]}
              fill={thirsty && i === 2 ? YELLOW : C[st[5]]} varg={varg && n === 0} />
          </g>
        );
      })}
    </g>
  );
}

// ---------- SPIDER ----------
function SpiderBlade({ rot, L, a, C, fill, stripe }: { rot: number; L: number; a: number; C: Palette; fill: string; stripe: string }) {
  const sg = a >= 0 ? 1 : -1;
  const d = `M0,0 C ${sg * 1.4},${-L * 0.55} ${a * 0.32},${-L * 1.0} ${a * 0.78},${-L * 0.97} C ${a * 1.05},${-L * 0.93} ${a * 1.2},${-L * 0.7} ${a * 1.26},${-L * 0.42} C ${a * 1.14},${-L * 0.56} ${a * 0.88},${-L * 0.74} ${a * 0.58},${-L * 0.78} C ${a * 0.26},${-L * 0.79} ${sg * 4.5},${-L * 0.4} ${sg * 4.5},0 Z`;
  const st = `M${sg * 1.2},-3 C ${sg * 1.5},${-L * 0.53} ${a * 0.36},${-L * 0.95} ${a * 0.76},${-L * 0.9} C ${a * 0.9},${-L * 0.86} ${a * 0.7},${-L * 0.76} ${a * 0.55},${-L * 0.74} C ${a * 0.3},${-L * 0.73} ${sg * 2.4},${-L * 0.38} ${sg * 2.2},-3 Z`;
  return (
    <g transform={`rotate(${rot})`}>
      <path d={d} fill={C.deep} transform="translate(1,1.1)" opacity=".9" />
      <path d={d} fill={fill} />
      <path d={st} fill={stripe} opacity=".75" />
    </g>
  );
}
function Pup({ x, y, s, flip, C }: { x: number; y: number; s: number; flip?: boolean; C: Palette }) {
  return (
    <g transform={`translate(${x},${y}) scale(${flip ? -s : s},${s})`}>
      {([[-64, 20], [-38, 24], [-12, 26], [14, 25], [40, 22], [64, 18], [-88, 15], [88, 13]] as [number, number][]).map((b, i) => (
        <g key={i} transform={`rotate(${b[0]})`}><path d={`M0,0 C2.2,${-b[1] * 0.45} 2.6,${-b[1] * 0.72} 0,${-b[1]} C-2.6,${-b[1] * 0.72} -2.2,${-b[1] * 0.45} 0,0 Z`} fill={i % 2 ? C.mid : C.dark} /></g>
      ))}
    </g>
  );
}
const SPIDER_FULL: [number, number, number][] = [
  [-3, 104, -4], [6, 98, 7],
  [-14, 92, -14], [-26, 84, -30], [-40, 76, -42], [-54, 68, -48], [-66, 56, -46], [-32, 50, -16],
  [14, 94, 16], [24, 88, 28], [34, 84, 40], [44, 78, 46], [54, 70, 50], [64, 62, 48], [72, 52, 46], [38, 48, 20],
];
function Spider({ size, C, droop, thirsty, varg }: { size: 1 | 2 | 3; C: Palette; droop: number; thirsty: boolean; varg: boolean }) {
  const pick = size === 1 ? [0, 1, 2, 8, 3, 9] : size === 2 ? [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 15] : SPIDER_FULL.map((_, i) => i);
  const Lk = size === 1 ? 0.66 : size === 2 ? 0.85 : 1;
  const stripe = varg ? "#eef3e4" : C.pale;
  return (
    <g>
      <g transform="translate(0,-1)">
        {pick.map((idx, i) => {
          const b = SPIDER_FULL[idx];
          const rot = b[0] + droop * 0.5 * (b[0] >= 0 ? 1 : -1);
          return <SpiderBlade key={idx} rot={rot} L={b[1] * Lk} a={b[2] * Lk} C={C} stripe={stripe}
            fill={thirsty && idx === 9 ? YELLOW : i % 3 === 2 ? C.light : i % 2 ? C.mid : C.dark} />;
        })}
      </g>
      {/* front 70% of the soil oval hides the blade convergence */}
      <path d="M-22.9,-1.6 A 25 4 0 1 0 22.9,-1.6 Z" fill={SOIL} />
      {size === 3 && <>
        {([[-6, -3, -4, 46, -8, C.dark], [7, -3, 5, 40, 9, C.mid]] as [number, number, number, number, number, string][]).map((f, i) => {
          const H = f[3], B = f[4];
          return (
            <g key={i} transform={`translate(${f[0]},${f[1]}) rotate(${f[2]})`}>
              <path d={`M-3,0 C ${-3 + B * 0.4},${H * 0.35} ${-1.6 + B * 0.8},${H * 0.7} ${B},${H} C ${1.6 + B * 0.8},${H * 0.7} ${3 + B * 0.4},${H * 0.35} 3,0 C 2,-2.6 -2,-2.6 -3,0 Z`} fill={f[5]} />
              <path d={`M-1.2,2 C ${-1 + B * 0.35},${H * 0.35} ${-0.6 + B * 0.7},${H * 0.6} ${B * 0.86},${H * 0.86} C ${0.6 + B * 0.7},${H * 0.6} ${1 + B * 0.35},${H * 0.35} 1.2,2 Z`} fill={stripe} opacity=".7" />
            </g>
          );
        })}
        <path d="M-8,-6 C -50,-22 -80,-6 -90,28 C -96,54 -93,76 -95,94" stroke={C.mid} strokeWidth="1.9" fill="none" />
        <path d="M-4,-2 C -40,8 -62,38 -66,78 C -68,110 -64,132 -66,148" stroke={C.mid} strokeWidth="1.7" fill="none" />
        <path d="M8,-6 C 52,-20 82,-2 90,34 C 96,62 93,96 95,126 C 96,148 92,166 94,182" stroke={C.mid} strokeWidth="1.9" fill="none" />
        <Pup x={-95} y={96} s={.95} C={C} />
        <Pup x={-66} y={150} s={.8} C={C} />
        <Pup x={95} y={126} s={.85} flip C={C} />
        <Pup x={94} y={184} s={.7} flip C={C} />
      </>}
      {size === 2 && <>
        <path d="M8,-6 C 44,-16 66,-2 72,26 C 76,44 74,58 75,72" stroke={C.mid} strokeWidth="1.8" fill="none" />
        <Pup x={75} y={76} s={.7} flip C={C} />
      </>}
    </g>
  );
}

export default function PlantVisual({ g, width = 260 }: { g: Pick<GardenState, "species" | "size" | "health" | "pot" | "trinket" | "variegation" | "bloom">; width?: number }) {
  const species: PlantSpecies = g.species ?? "pothos";
  const C = g.variegation === "golden" ? GOLDEN : GREENS;
  const droop = g.health === "thirsty" ? 12 : g.health === "okay" ? 6 : 0;
  const thirsty = g.health === "thirsty";
  const varg = g.variegation === "variegated";
  const origin = species === "pothos" ? "translate(150,120)" : species === "monstera" ? "translate(150,158)" : "translate(150,150)";
  const bloomPos = species === "pothos" ? { x: 26, y: -28 } : species === "monstera" ? { x: 42, y: -100 } : { x: 32, y: -82 };
  return (
    <svg viewBox="0 0 300 340" width={width} height={width * 1.13} aria-label="Your Inven(s)tory plant" role="img">
      <g transform={origin}><Pot rx={species === "pothos" ? 24 : 28} kind={g.pot} /><Trinket kind={g.trinket} /></g>
      <g transform={origin}>
        {species === "pothos" && <Pothos size={g.size} C={C} droop={droop} thirsty={thirsty} varg={varg} />}
        {species === "monstera" && <Monstera size={g.size} C={C} droop={droop} thirsty={thirsty} varg={varg} />}
        {species === "spider" && <Spider size={g.size} C={C} droop={droop} thirsty={thirsty} varg={varg} />}
        {g.bloom !== "none" && <Bloom kind={g.bloom} x={bloomPos.x} y={bloomPos.y} />}
      </g>
    </svg>
  );
}
