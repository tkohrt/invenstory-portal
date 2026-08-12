import "server-only";
// Central Bedrock client factory. Two auth paths:
//  - If AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key) is set, let the SDK use the
//    bearer-token auth scheme — do NOT pass explicit credentials (they'd override it).
//  - Otherwise use the portal's IAM access keys (SigV4).
// The control-plane client always uses SigV4 access keys, because the bearer
// token only authenticates the inference (runtime/mantle) endpoints.
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockClient } from "@aws-sdk/client-bedrock";

export const BEDROCK_REGION = process.env.PORTAL_AWS_REGION ?? "us-east-1";
// Set this to an INFERENCE PROFILE ID (e.g. "us.anthropic.claude-sonnet-4-...")
// for current Claude models — bare model IDs are rejected for on-demand calls.
export const CHAT_MODEL_ID = process.env.BEDROCK_CHAT_MODEL_ID ?? "";

export type BedrockAuthMode = "api_key" | "access_keys" | "none";
export function bedrockAuthMode(): BedrockAuthMode {
  if (process.env.AWS_BEARER_TOKEN_BEDROCK) return "api_key";
  if (process.env.PORTAL_AWS_ACCESS_KEY_ID && process.env.PORTAL_AWS_SECRET_ACCESS_KEY) return "access_keys";
  return "none";
}

function accessKeyCreds() {
  return (process.env.PORTAL_AWS_ACCESS_KEY_ID && process.env.PORTAL_AWS_SECRET_ACCESS_KEY)
    ? { credentials: { accessKeyId: process.env.PORTAL_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.PORTAL_AWS_SECRET_ACCESS_KEY } }
    : {};
}

// Inference (Converse/Invoke). Prefers the bearer token when present.
export function bedrockRuntime(): BedrockRuntimeClient {
  const auth = process.env.AWS_BEARER_TOKEN_BEDROCK ? {} : accessKeyCreds();
  return new BedrockRuntimeClient({ region: BEDROCK_REGION, ...auth });
}

// Control plane (model availability, listing). Always SigV4.
export function bedrockControl(): BedrockClient {
  return new BedrockClient({ region: BEDROCK_REGION, ...accessKeyCreds() });
}

// Is generation configured at all? (used to choose Bedrock prose vs fallback)
export function bedrockConfigured(): boolean {
  return Boolean(CHAT_MODEL_ID) && bedrockAuthMode() !== "none";
}
