"use client";
import { useState } from "react";
import type { VertexCheck } from "@/lib/server/vertex-check";

const LABEL: Record<VertexCheck["redLayer"], string> = {
  none: "✓ Working", not_configured: "Not configured", auth: "Authentication",
  api_disabled: "Vertex API disabled", permission: "IAM permissions",
  model_access: "Model access (Model Garden)", model_id: "Model / region",
  billing: "Billing", quota: "Quota", unknown: "Unknown",
};

export default function VertexCheckView({ initial }: { initial: VertexCheck }) {
  const [data, setData] = useState<VertexCheck>(initial);
  const [model, setModel] = useState(initial.config.model);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await fetch(`/api/admin/vertex-check?model=${encodeURIComponent(model)}`);
    setData(await r.json()); setBusy(false);
  };
  const green = data.redLayer === "none";
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Vertex (Claude) diagnostic</h2>
          <p>Checks Claude on Google Vertex AI end to end and pinpoints any blocker: credentials, the Vertex API, the service-account role, Model Garden access, model/region, billing, or quota. Green here means generation is ready — set <code>LLM_PROVIDER=vertex</code> and the portal switches from extractive drafts to prose.</p>
        </div>
      </div>

      <div className={`bx-verdict ${green ? "ok" : "bad"}`}>
        <div className="bx-layer">{LABEL[data.redLayer]}</div>
        <p>{data.verdict}</p>
      </div>

      <div className="bx-row">
        <label>Model id (Vertex @snapshot format)
          <input value={model} onChange={e => setModel(e.target.value)} />
        </label>
        <button className="btn" onClick={run} disabled={busy}>{busy ? "Checking…" : "Run check"}</button>
      </div>

      <div className="section-label">Config</div>
      <table className="bx-table"><tbody>
        <tr><td>Active provider</td><td>{data.config.provider}</td></tr>
        <tr><td>Project</td><td>{data.config.project || "— (VERTEX_PROJECT_ID not set)"}</td></tr>
        <tr><td>Region</td><td>{data.config.region}</td></tr>
        <tr><td>Model</td><td>{data.config.model}</td></tr>
        <tr><td>Credentials present</td><td>{data.config.credentials ? "yes" : "no (GOOGLE_VERTEX_CREDENTIALS not set)"}</td></tr>
      </tbody></table>

      <div className="section-label">Probe (live Vertex call)</div>
      <pre className="bx-pre">{JSON.stringify(data.probe, null, 2)}</pre>
    </div>
  );
}
