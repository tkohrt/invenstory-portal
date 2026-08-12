"use client";
import { useState } from "react";
import type { BedrockCheck } from "@/lib/server/bedrock-check";

const LAYER_LABEL: Record<BedrockCheck["redLayer"], string> = {
  none: "✓ Working", auth: "Authentication", model_access: "Model access",
  model_id: "Model identifier", quota: "Quota", unknown: "Unknown",
};

export default function BedrockCheckView({ initial }: { initial: BedrockCheck }) {
  const [data, setData] = useState<BedrockCheck>(initial);
  const [model, setModel] = useState(initial.config.modelId);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const r = await fetch(`/api/admin/bedrock-check?model=${encodeURIComponent(model)}`);
    setData(await r.json()); setBusy(false);
  };
  const green = data.redLayer === "none";
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Bedrock diagnostic</h2>
          <p>Pinpoints which layer is blocking generation: authentication, model access, model identifier, or quota. When this shows green, set <code>BEDROCK_CHAT_MODEL_ID</code> in production and the portal switches from extractive drafts to prose.</p>
        </div>
      </div>

      <div className={`bx-verdict ${green ? "ok" : "bad"}`}>
        <div className="bx-layer">{LAYER_LABEL[data.redLayer]}</div>
        <p>{data.verdict}</p>
      </div>

      <div className="bx-row">
        <label>Model id (inference-profile id for current Claude)
          <input value={model} onChange={e => setModel(e.target.value)} />
        </label>
        <button className="btn" onClick={run} disabled={busy}>{busy ? "Checking…" : "Run check"}</button>
      </div>

      <div className="section-label">Config</div>
      <table className="bx-table"><tbody>
        <tr><td>Region</td><td>{data.config.region}</td></tr>
        <tr><td>Auth mode</td><td>{data.config.authMode}{data.config.authMode === "none" && " — no credentials set"}</td></tr>
        <tr><td>Model id</td><td>{data.config.modelId}</td></tr>
        <tr><td>Inference profile?</td><td>{data.config.usingInferenceProfile ? "yes" : "no (bare id — likely rejected)"}</td></tr>
      </tbody></table>

      <div className="section-label">Model availability (control plane)</div>
      <pre className="bx-pre">{JSON.stringify(data.availability, null, 2)}</pre>

      <div className="section-label">Converse probe (runtime)</div>
      <pre className="bx-pre">{JSON.stringify(data.probe, null, 2)}</pre>
    </div>
  );
}
