import "server-only";
// Bedrock diagnostic: pinpoints which layer is blocking generation.
//  1) availability  -> model access / entitlement / region (via control plane)
//  2) converse probe -> the exact runtime error, mapped to a human verdict
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetFoundationModelAvailabilityCommand } from "@aws-sdk/client-bedrock";
import { bedrockRuntime, bedrockControl, bedrockAuthMode, BEDROCK_REGION, CHAT_MODEL_ID } from "./bedrock";

// Strip an inference-profile prefix ("us." / "eu." / "apac." / "global.") to get
// the base model id that the availability API expects.
function baseModelId(id: string) { return id.replace(/^(us|eu|apac|global|us-gov)\./, ""); }

export interface BedrockCheck {
  config: { region: string; authMode: string; modelId: string; usingInferenceProfile: boolean };
  availability: Record<string, unknown> | { error: string };
  probe: { ok: boolean; errorName?: string; message?: string; httpStatus?: number };
  verdict: string;
  redLayer: "none" | "auth" | "model_access" | "model_id" | "quota" | "unknown";
}

function interpret(probe: BedrockCheck["probe"]): { verdict: string; redLayer: BedrockCheck["redLayer"] } {
  if (probe.ok) return { verdict: "All green — Bedrock generation is working. Set BEDROCK_CHAT_MODEL_ID in prod to switch the portal from extractive to prose.", redLayer: "none" };
  const n = probe.errorName ?? "";
  if (/AccessDenied/i.test(n))
    return { verdict: "Model access / entitlement. Most likely the one-time Anthropic use-case form isn't submitted for this account, or the principal lacks aws-marketplace:Subscribe / a valid payment method. Fix in the Bedrock console (open a Claude model in the playground; fill the use-case form).", redLayer: "model_access" };
  if (/Validation/i.test(n))
    return { verdict: "Model identifier. This model needs an INFERENCE PROFILE ID (e.g. us.anthropic.claude-...), not a bare model id — or the id/region is wrong. Set BEDROCK_CHAT_MODEL_ID to the inference-profile id from the model's detail page.", redLayer: "model_id" };
  if (/Throttling|ServiceQuotaExceeded|TooManyRequests/i.test(n))
    return { verdict: "Quota. The account's per-model TPM/RPM is throttling (often 0 on new accounts). Request an increase in Service Quotas for this model on the bedrock-runtime endpoint.", redLayer: "quota" };
  if (/UnrecognizedClient|InvalidSignature|Unauthorized|AccessToken|Forbidden|MissingAuthentication/i.test(n))
    return { verdict: "Authentication. The credentials/API key are missing or invalid. Check AWS_BEARER_TOKEN_BEDROCK or the PORTAL_AWS_* access keys.", redLayer: "auth" };
  if (/ResourceNotFound/i.test(n))
    return { verdict: "Model/region not found. The model id isn't available in this region — check the model's Regional availability, or switch PORTAL_AWS_REGION.", redLayer: "model_id" };
  return { verdict: `Unexpected error (${n}). See the message.`, redLayer: "unknown" };
}

export async function runBedrockCheck(modelOverride?: string): Promise<BedrockCheck> {
  const modelId = modelOverride || CHAT_MODEL_ID || "us.anthropic.claude-sonnet-4-20250514-v1:0";
  const usingInferenceProfile = /^(us|eu|apac|global|us-gov)\./.test(modelId);
  const config = { region: BEDROCK_REGION, authMode: bedrockAuthMode(), modelId, usingInferenceProfile };

  // 1) availability (control plane)
  let availability: BedrockCheck["availability"];
  try {
    const r = await bedrockControl().send(new GetFoundationModelAvailabilityCommand({ modelId: baseModelId(modelId) }));
    availability = {
      agreementAvailability: r.agreementAvailability?.status,
      authorizationStatus: r.authorizationStatus,
      entitlementAvailability: r.entitlementAvailability,
      regionAvailability: r.regionAvailability,
    };
  } catch (e) {
    availability = { error: e instanceof Error ? `${e.name}: ${e.message}` : "availability check failed" };
  }

  // 2) converse probe (runtime — exactly what the app does)
  const probe: BedrockCheck["probe"] = { ok: false };
  try {
    await bedrockRuntime().send(new ConverseCommand({
      modelId,
      messages: [{ role: "user", content: [{ text: "ping" }] }],
      inferenceConfig: { maxTokens: 5, temperature: 0 },
    }));
    probe.ok = true;
  } catch (e) {
    const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    probe.errorName = err.name; probe.message = err.message; probe.httpStatus = err.$metadata?.httpStatusCode;
  }

  const { verdict, redLayer } = interpret(probe);
  return { config, availability, probe, verdict, redLayer };
}
