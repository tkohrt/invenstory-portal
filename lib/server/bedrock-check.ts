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

function interpret(probe: BedrockCheck["probe"], av: Record<string, unknown>): { verdict: string; redLayer: BedrockCheck["redLayer"] } {
  if (probe.ok) return { verdict: "All green — Bedrock generation is working. Set BEDROCK_CHAT_MODEL_ID in prod to switch the portal from extractive to prose.", redLayer: "none" };
  const n = probe.errorName ?? "";
  const auth = av.authorizationStatus, agree = av.agreementAvailability, region = av.regionAvailability;

  // Availability signals are definitive — weigh them before the raw error name.
  if (region === "NOT_AVAILABLE")
    return { verdict: "Model/region. This model isn't available in the configured region. Use a region where it's offered (check the model's Regional availability) or change PORTAL_AWS_REGION.", redLayer: "model_id" };
  if (auth === "NOT_AUTHORIZED" || agree === "NOT_AVAILABLE")
    return { verdict: "Model access. The account is NOT subscribed/authorized for this model (agreement not established) — this is the block, not the model id or quota. For Anthropic, submit the one-time use-case form: Bedrock console → open this Claude model → Playground → fill the form (name, website, use case). Also ensure the principal has aws-marketplace:Subscribe and the account has a valid payment method. Access is granted within a couple of minutes of submitting.", redLayer: "model_access" };

  if (/AccessDenied/i.test(n))
    return { verdict: "Model access / entitlement. Likely the one-time Anthropic use-case form isn't submitted, or the principal lacks aws-marketplace:Subscribe / a valid payment method. Fix in the Bedrock console (open a Claude model in the playground; fill the use-case form).", redLayer: "model_access" };
  if (/Throttling|ServiceQuotaExceeded|TooManyRequests/i.test(n))
    return { verdict: "Quota. The account's per-model TPM/RPM is throttling (often 0 on new accounts). Request an increase in Service Quotas for this model on the bedrock-runtime endpoint.", redLayer: "quota" };
  if (/UnrecognizedClient|InvalidSignature|Unauthorized|AccessToken|Forbidden|MissingAuthentication/i.test(n))
    return { verdict: "Authentication. The credentials/API key are missing or invalid. Check AWS_BEARER_TOKEN_BEDROCK or the PORTAL_AWS_* access keys.", redLayer: "auth" };
  if (/Validation/i.test(n))
    return { verdict: "Model identifier. If access is authorized, this model may need a different INFERENCE PROFILE ID or region. Set BEDROCK_CHAT_MODEL_ID to the inference-profile id from the model's detail page.", redLayer: "model_id" };
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

  const { verdict, redLayer } = interpret(probe, ("error" in availability ? {} : availability));
  return { config, availability, probe, verdict, redLayer };
}
