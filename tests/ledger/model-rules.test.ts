/** Moving off Claude Sonnet 4.5 on Bedrock (patch 20, 5 Nov 2026). */
import { describe, expect, test } from "vitest";
import { isAdaptiveModel, converseParams, scaledMaxTokens, effortFrom, claudeVersion } from "@/lib/model-rules";
import { rateFor, costMicros } from "@/lib/ai-pricing";

const OLD = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const NEW = "us.anthropic.claude-sonnet-5-5";

describe("which models need the new settings", () => {
  test("reads versions from every id shape", () => {
    expect(claudeVersion(OLD)).toEqual({ family: "sonnet", version: 4.5 });
    expect(claudeVersion(NEW)).toEqual({ family: "sonnet", version: 5.5 });
    expect(claudeVersion("global.anthropic.claude-sonnet-5-5")?.version).toBe(5.5);
    expect(claudeVersion("anthropic.claude-sonnet-4-20250514-v1:0")?.version).toBe(4);
    expect(claudeVersion("amazon.titan")).toBeNull();
  });
  test("Sonnet 5.x, Opus 4.7 and later, Fable and Mythos are adaptive; older models are not", () => {
    for (const id of [NEW, "us.anthropic.claude-sonnet-5", "anthropic.claude-opus-4-7", "anthropic.claude-opus-5-5", "anthropic.claude-haiku-5-5", "anthropic.claude-fable-5-1"]) expect(isAdaptiveModel(id)).toBe(true);
    for (const id of [OLD, "anthropic.claude-sonnet-4-6", "anthropic.claude-opus-4-6-v1", "anthropic.claude-haiku-4-5-20251001-v1:0", ""]) expect(isAdaptiveModel(id)).toBe(false);
  });
});

describe("what a Converse call sends", () => {
  test("an older model gets exactly what it got before", () => {
    expect(converseParams(OLD, 700, 0.2)).toEqual({ inferenceConfig: { maxTokens: 700, temperature: 0.2 } });
  });
  test("Sonnet 5.5 gets no temperature, no thinking before a plain answer, an effort level, and room for the bigger token count", () => {
    const p = converseParams(NEW, 700, 0.2);
    expect(p.inferenceConfig).toEqual({ maxTokens: 910 });
    expect("temperature" in p.inferenceConfig).toBe(false);
    expect(p.additionalModelRequestFields).toEqual({ thinking: { type: "between_tools" }, output_config: { effort: "high" } });
    expect(scaledMaxTokens(NEW, 5)).toBe(7);
  });
  test("effort defaults to high and only takes the known levels", () => {
    expect(effortFrom(undefined)).toBe("high");
    expect(effortFrom("medium")).toBe("medium");
    expect(effortFrom("turbo")).toBe("high");
    expect(converseParams(NEW, 100, 0, "low").additionalModelRequestFields).toMatchObject({ output_config: { effort: "low" } });
  });
});

describe("pricing", () => {
  test("Sonnet 5.5 is $2 / $10, plus 10% on a US profile", () => {
    expect(rateFor(NEW)).toMatchObject({ input: 2, output: 10, premium: true });
    expect(rateFor("global.anthropic.claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10, premium: false });
    expect(costMicros(NEW, 1_000_000, 100_000)).toBe(Math.round((2_000_000 + 1_000_000) * 1.1));
  });
  test("Sonnet 4.5 keeps its old price", () => {
    expect(rateFor(OLD)).toMatchObject({ input: 3, output: 15, premium: true });
  });
});
