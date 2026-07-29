import "server-only";
// Story Intelligence type registry — the generic heart of the engine.
// Adding a new artifact type = one entry here (prompt + card zod schema +
// grounded fallback) + a card renderer in ArtifactPanel + a DB artifact_type
// row. No engine changes. That is the "new type in a day" claim, in code.
import { z } from "zod";

export interface CorpusDoc {
  id: string; title: string; layer: string; snippet: string;
  tags: string[]; chunks: string[];
}

export interface SIType {
  slug: string;
  system: string;
  buildPrompt: (docs: CorpusDoc[]) => string;
  cardSchema: z.ZodType<{ title: string; payload: Record<string, string>; citation_titles: string[] }[]>;
  // Grounded draft when Bedrock generation is unavailable — real corpus
  // evidence, clearly a placeholder pending true synthesis.
  fallback: (docs: CorpusDoc[]) => { title: string; payload: Record<string, string>; citation_titles: string[] }[];
  gapNote: (docs: CorpusDoc[]) => string;
}

const cardArray = (payloadKeys: [string, ...string[]]) =>
  z.array(z.object({
    title: z.string().min(3),
    payload: z.object(Object.fromEntries(payloadKeys.map(k => [k, z.string()]))).partial().and(z.record(z.string(), z.string())),
    citation_titles: z.array(z.string()).min(1), // every card MUST cite
  })).min(1).max(8);

function corpusDigest(docs: CorpusDoc[]): string {
  return docs.map(d => `# ${d.title} (Layer ${d.layer}${d.tags.length ? `, tags: ${d.tags.join(", ")}` : ""})\n${[d.snippet, ...d.chunks].filter(Boolean).join("\n").slice(0, 1200)}`).join("\n\n");
}

function byTag(docs: CorpusDoc[]): Map<string, CorpusDoc[]> {
  const m = new Map<string, CorpusDoc[]>();
  docs.forEach(d => d.tags.forEach(t => { const a = m.get(t) ?? []; a.push(d); m.set(t, a); }));
  return m;
}

export const SI_TYPES: Record<string, SIType> = {

  fundability_snapshot: {
    slug: "fundability_snapshot",
    system: `You write a single tight paragraph summarizing why this organization is fundable, grounded only in the provided documents. Cite the documents by exact title. Output JSON: an array with ONE object {title, body, citation_titles[]}.`,
    buildPrompt: (docs) => `Documents:\n\n${corpusDigest(docs)}\n\nReturn ONE fundability paragraph as JSON array of {title, body, citation_titles}.`,
    cardSchema: cardArray(["body"]),
    fallback: (docs) => [{
      title: "Fundability snapshot",
      payload: { body: `This organization presents ${docs.length} documents across ${new Set(docs.map(d => d.layer)).size} Inven(s)tory layers, including ${docs.filter(d => d.layer === "III").length} first-person accounts. Strongest fundable signal: ${docs.find(d => d.layer === "III")?.snippet ?? docs[0]?.snippet ?? "captured mission material"}` },
      citation_titles: docs.slice(0, 3).map(d => d.title),
    }],
    gapNote: () => "Add a recent 990 or budget to strengthen the financial-health signal funders weigh.",
  },
  themes: {
    slug: "themes",
    system: `You surface the recurring themes, mission threads, and values in a mission-driven organization's story. Read across ALL provided documents. Return only themes genuinely supported by the material. Every theme MUST cite the documents it draws from by exact title. Never invent. Output JSON: an array of {title, body, citation_titles[]}.`,
    buildPrompt: (docs) => `Documents:\n\n${corpusDigest(docs)}\n\nReturn 3-5 themes as JSON array of {title, body, citation_titles}.`,
    cardSchema: cardArray(["body"]),
    fallback: (docs) => {
      const tags = [...byTag(docs).entries()].filter(([, ds]) => ds.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
      const cards = tags.map(([tag, ds]) => ({
        title: `Recurring thread: ${tag.replace(/-/g, " ")}`,
        payload: { body: `This idea recurs across ${ds.length} documents (${ds.map(d => `"${d.title}"`).join(", ")}). A representative excerpt: ${ds[0].snippet}` },
        citation_titles: ds.map(d => d.title),
      }));
      return cards.length ? cards : [{
        title: "Story foundation captured",
        payload: { body: `The Inven(s)tory holds ${docs.length} documents across the three layers. Add more tagged material to surface stronger recurring themes.` },
        citation_titles: [docs[0]?.title ?? "your documents"],
      }];
    },
    gapNote: (docs) => {
      const layers = new Set(docs.map(d => d.layer));
      if (!layers.has("III")) return "Layer III is empty — adding interview material would deepen the human threads in your story.";
      if (!layers.has("II")) return "Layer II is light — strategy and internal documents would strengthen the themes funders look for.";
      return "Adding outcome data would sharpen the impact threads in these themes.";
    },
  },

  impact_metrics: {
    slug: "impact_metrics",
    system: `You propose funder-ready impact metrics grounded in an organization's own documents. For each metric return: what it measures, why funders care, how to measure it, a formula, an example drawn from the org's materials, and a gap (what they're not yet capturing). Read across ALL documents. Cite by exact title. Output JSON: array of {title, measures, why, how, formula, example, gap, citation_titles[]}.`,
    buildPrompt: (docs) => `Documents:\n\n${corpusDigest(docs)}\n\nReturn 2-4 impact metrics as JSON array of {title, measures, why, how, formula, example, gap, citation_titles}.`,
    cardSchema: cardArray(["measures", "why", "how", "formula", "example", "gap"]),
    fallback: (docs) => {
      const budget = docs.find(d => d.tags.includes("budget") || /budget/i.test(d.title));
      const prog = docs.find(d => d.tags.includes("programs") || d.tags.includes("transportation") || d.layer === "II");
      const anchor = budget ?? prog ?? docs[0];
      if (!anchor) return [];
      return [{
        title: "Program reach (starter metric)",
        payload: {
          measures: "How many people your core program serves in a period.",
          why: "Funders open with reach — it frames every other outcome.",
          how: "Count unique participants served per month from program records.",
          formula: "unique participants served ÷ reporting period",
          example: `Grounded in "${anchor.title}": ${anchor.snippet}`,
          gap: "A month-over-month participant count is not yet captured in the documents provided.",
        },
        citation_titles: [anchor.title, ...(prog && prog !== anchor ? [prog.title] : [])],
      }];
    },
    gapNote: () => "Provide dispatch/attendance records to unlock outcome and retention metrics beyond reach.",
  },
};

export function validateCards(slug: string, cards: unknown) {
  const t = SI_TYPES[slug];
  if (!t) throw new Error(`unknown artifact type ${slug}`);
  return t.cardSchema.parse(cards);
}
