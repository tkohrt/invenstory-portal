// What each Claude generation accepts on Bedrock's Converse API (patch 20,
// 5 November 2026: moving off Claude Sonnet 4.5, Legacy on Bedrock since
// 8 Oct 2026, end of life 8 Apr 2027).
//
// Claude Sonnet 5.x, Opus 4.7 and later, and the other 5.x families:
//   - reject temperature, top_p and top_k (400), so none is sent;
//   - think adaptively unless told otherwise, and thinking spends max tokens
//     and time. `between_tools` is the lowest setting (no thinking before a
//     plain answer), which keeps the behaviour the portal was written for;
//   - take an effort level in `output_config`;
//   - turn the same text into about 30% more tokens, so max tokens is raised
//     to keep answers from being cut short.
// Older models get exactly what they got before. Pure, tested in
// tests/ledger/model-rules.test.ts.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function claudeVersion(modelId: string): { family: string; version: number } | null {
  const m = modelId.toLowerCase().match(/claude-(sonnet|haiku|opus|fable|mythos)-(\d+)(?:-(\d)(?!\d))?/);
  if (!m) return null;
  return { family: m[1], version: Number(m[2]) + (m[3] ? Number(m[3]) / 10 : 0) };
}

/** No sampling parameters, adaptive thinking by default. */
export function isAdaptiveModel(modelId: string): boolean {
  const v = claudeVersion(modelId);
  if (!v) return false;
  if (v.family === "fable" || v.family === "mythos") return true;
  if (v.family === "opus") return v.version >= 4.7;
  return v.version >= 5;
}

/** Raised for the larger token count of the newer tokenizer. */
export function scaledMaxTokens(modelId: string, maxTokens: number): number {
  return isAdaptiveModel(modelId) ? Math.ceil(maxTokens * 1.3) : maxTokens;
}

export function effortFrom(raw: string | undefined): Effort {
  return raw === "low" || raw === "medium" || raw === "xhigh" || raw === "max" ? raw : "high";
}

/** JSON as the AWS SDK types it (its DocumentType), without importing the SDK here. */
type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface ConverseParams {
  inferenceConfig: { maxTokens: number; temperature?: number };
  additionalModelRequestFields?: { [k: string]: Json };
}

/** The inference settings one Converse call should send for this model. */
export function converseParams(modelId: string, maxTokens: number, temperature: number, effort: Effort = "high"): ConverseParams {
  if (!isAdaptiveModel(modelId)) return { inferenceConfig: { maxTokens, temperature } };
  return {
    inferenceConfig: { maxTokens: scaledMaxTokens(modelId, maxTokens) },
    additionalModelRequestFields: { thinking: { type: "between_tools" }, output_config: { effort } },
  };
}
