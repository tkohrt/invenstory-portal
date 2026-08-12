import "server-only";
// Embedding-ranked extractive refinement. Turns retrieved passages into a
// tighter answer WITHOUT a generative model: split into sentences, strip
// transcript filler, rank each sentence against the question using Supabase
// gte-small embeddings, and stitch the best ones into a short + long answer.
// This is selected-and-cleaned text, not original prose — it upgrades to real
// prose automatically when a generative model (Bedrock) is available.
import { embedTexts } from "./embed";
import type { Passage } from "./rag";

const FILLERS: RegExp[] = [
  /\b(um+|uh+|erm|hmm)\b/gi, /\byou know\b/gi, /\bi mean\b/gi,
  /\bkind of\b/gi, /\bsort of\b/gi, /\bi guess\b/gi, /\bbasically\b/gi,
];

function cleanSentence(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  // drop conversational lead-ins (repeatedly, e.g. "so, and, ...")
  for (let i = 0; i < 3; i++) t = t.replace(/^(so|and|but|well|okay|ok|yeah|yep|right|like|now|anyway|i think that|i think|you know)[,\s]+/i, "");
  for (const f of FILLERS) t = t.replace(f, "");
  t = t.replace(/\b(\w+)(?:[,\s]+\1\b)+/gi, "$1");      // collapse stutters: "it, it" / "we're we're"
  t = t.replace(/\s+([,.;:!?])/g, "$1");                 // no space before punctuation
  t = t.replace(/([,;:])(?:\s*[,;:])+/g, "$1");          // collapse repeated punctuation
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^[,;:\-\s]+/, "").replace(/[,;:\s]+$/, "").trim();  // strip dangling punctuation
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (let s of text.split(/(?<=[.!?])\s+/)) {
    s = s.trim(); if (!s) continue;
    const w = s.split(/\s+/);
    if (w.length > 55) { for (let i = 0; i < w.length; i += 35) out.push(w.slice(i, i + 35).join(" ")); }
    else out.push(s);
  }
  return out;
}

const cosine = (a: number[], b: number[]) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };
const endPunct = (t: string) => (/[.!?]"?$/.test(t) ? t : t + ".");

export interface Refined { short: string | null; long: string | null; topScore: number; nGood: number }

export async function refineExtractive(query: string, passages: Passage[]): Promise<Refined | null> {
  const cands: { text: string; order: number }[] = [];
  passages.slice(0, 5).forEach((p, pi) => {
    splitSentences(p.text).forEach((s, si) => {
      const c = cleanSentence(s);
      const wc = c.split(/\s+/).length;
      if (wc >= 5 && wc <= 45 && c.length <= 400) cands.push({ text: c, order: pi * 100 + si });
    });
  });
  const seen = new Set<string>();
  const uniq = cands.filter(c => { const k = c.text.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
  if (uniq.length === 0) return null;

  const capped = uniq.slice(0, 24);
  const vecs = await embedTexts([query, ...capped.map(c => c.text)]);
  if (!vecs || vecs.length !== capped.length + 1 || !vecs[0]) return null;
  const qv = vecs[0]!;
  const scored = capped.map((c, i) => ({ ...c, score: vecs[i + 1] ? cosine(qv, vecs[i + 1]!) : 0 }))
    .sort((a, b) => b.score - a.score);

  const topScore = scored[0]?.score ?? 0;
  const nGood = scored.filter(s => s.score >= 0.35).length;

  // short: best 1–2 sentences, ≤ ~55 words
  const shortSents: string[] = []; let sw = 0;
  for (const s of scored) {
    const w = s.text.split(/\s+/).length;
    if (sw + w > 60 && shortSents.length >= 1) break;
    shortSents.push(s.text); sw += w;
    if (shortSents.length >= 2) break;
  }
  // long: top ~8 sentences, restored to reading order, ≤ ~250 words
  const longPick = scored.slice(0, 8).sort((a, b) => a.order - b.order);
  const longSents: string[] = []; let lw = 0;
  for (const s of longPick) { const w = s.text.split(/\s+/).length; if (lw + w > 250) break; longSents.push(s.text); lw += w; }

  return {
    short: shortSents.length ? shortSents.map(endPunct).join(" ") : null,
    long: longSents.length ? longSents.map(endPunct).join(" ") : null,
    topScore, nGood,
  };
}
