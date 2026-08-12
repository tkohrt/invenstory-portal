import "server-only";
// Vertex (Claude) diagnostic — mirrors the Bedrock one. Pinpoints which layer is
// blocking: config, authentication, API-not-enabled, IAM role, model access
// (Model Garden), model/region, billing, or quota.
import { generationProvider } from "./llm";

const PROJECT = process.env.VERTEX_PROJECT_ID ?? "";
const REGION = process.env.VERTEX_REGION ?? "us-east5";
const MODEL = process.env.VERTEX_CLAUDE_MODEL ?? "claude-sonnet-4@20250514";
const HAS_CREDS = Boolean(process.env.GOOGLE_VERTEX_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS);

export type VertexRedLayer =
  | "none" | "not_configured" | "auth" | "api_disabled" | "permission"
  | "model_access" | "model_id" | "billing" | "quota" | "unknown";

export interface VertexCheck {
  config: { provider: string; project: string; region: string; model: string; credentials: boolean };
  probe: { ok: boolean; errorName?: string; message?: string; status?: number };
  verdict: string;
  redLayer: VertexRedLayer;
}

function interpret(cfg: VertexCheck["config"], probe: VertexCheck["probe"]): { verdict: string; redLayer: VertexRedLayer } {
  if (!cfg.project || !cfg.credentials) {
    const missing: string[] = [];
    if (!cfg.project) missing.push("VERTEX_PROJECT_ID");
    if (!cfg.credentials) missing.push("GOOGLE_VERTEX_CREDENTIALS");
    return { verdict: `Not configured yet. Set ${missing.join(" and ")} (plus VERTEX_REGION and VERTEX_CLAUDE_MODEL) on Vercel, then re-run this check.`, redLayer: "not_configured" };
  }
  if (probe.ok) return { verdict: "All green — Claude on Vertex is responding. Set LLM_PROVIDER=vertex (if not already) and the Answer Library + chat switch from extractive to prose.", redLayer: "none" };
  const m = (probe.message ?? "").toLowerCase();
  const s = probe.status;
  if (s === 401 || /could not load the default credentials|invalid_grant|invalid jwt|unauthenticated|invalid authentication|account not found/.test(m))
    return { verdict: "Authentication. The service-account credentials are missing or invalid. Confirm GOOGLE_VERTEX_CREDENTIALS is the full service-account JSON (one line) and the key is active.", redLayer: "auth" };
  if (/has not been used|service_disabled|is disabled|enable it by visiting|accessnotconfigured/.test(m))
    return { verdict: "Vertex AI API not enabled. Enable the Vertex AI API on this GCP project, then retry.", redLayer: "api_disabled" };
  if (/must agree|accept the|not been granted access|publisher model|access to (the )?model|model is not accessible|not enabled/.test(m))
    return { verdict: "Model access. The Claude model isn't enabled in Vertex AI Model Garden for this project. Open the model in Model Garden and click Enable (accept terms), then retry.", redLayer: "model_access" };
  if (s === 403 || /permission|aiplatform\.|iam|does not have|forbidden/.test(m))
    return { verdict: "Permissions. The service account needs the Vertex AI User role (roles/aiplatform.user). Grant it in IAM. (If the role is present, the model may not be enabled in Model Garden.)", redLayer: "permission" };
  if (s === 404 || /not found|notfound|does not exist|unsupported|invalid model|no endpoints/.test(m))
    return { verdict: "Model id / region. The model isn't available at this id+region. Check VERTEX_CLAUDE_MODEL (e.g. claude-sonnet-4@20250514) and VERTEX_REGION (us-east5, us-central1, europe-west1, or global).", redLayer: "model_id" };
  if (/billing/.test(m))
    return { verdict: "Billing. Enable billing on the GCP project before using paid models.", redLayer: "billing" };
  if (s === 429 || /resource_exhausted|quota|rate limit|too many requests/.test(m))
    return { verdict: "Quota. The project's Vertex quota for this model is throttling. Request an increase in the GCP quotas console.", redLayer: "quota" };
  return { verdict: `Unexpected error${probe.errorName ? ` (${probe.errorName})` : ""}. See the message below.`, redLayer: "unknown" };
}

export async function runVertexCheck(modelOverride?: string): Promise<VertexCheck> {
  const model = modelOverride || MODEL;
  const config = { provider: generationProvider(), project: PROJECT, region: REGION, model, credentials: HAS_CREDS };
  const probe: VertexCheck["probe"] = { ok: false };

  if (PROJECT && HAS_CREDS) {
    try {
      const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
      const { GoogleAuth } = await import("google-auth-library");
      const credentials = process.env.GOOGLE_VERTEX_CREDENTIALS ? JSON.parse(process.env.GOOGLE_VERTEX_CREDENTIALS) : undefined;
      const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"], ...(credentials ? { credentials } : {}) });
      const client = new AnthropicVertex({
        region: REGION, projectId: PROJECT,
        googleAuth: googleAuth as unknown as NonNullable<ConstructorParameters<typeof AnthropicVertex>[0]>["googleAuth"],
      });
      await client.messages.create({ model, max_tokens: 5, messages: [{ role: "user", content: "ping" }] });
      probe.ok = true;
    } catch (e) {
      const err = e as { name?: string; message?: string; status?: number };
      probe.errorName = err.name; probe.message = err.message; probe.status = err.status;
    }
  }
  const { verdict, redLayer } = interpret(config, probe);
  return { config, probe, verdict, redLayer };
}
