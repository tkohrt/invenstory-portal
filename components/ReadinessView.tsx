"use client";
// P1.5 (patch 38): the readiness checklist's own screen. The full checklist
// (ReadinessCard) lives here now; the Inven(s)tory page keeps only the strip.
// Uploading from an item opens the same drawer as the Inven(s)tory page, so
// nothing bounces between screens.
import { useState } from "react";
import { useRouter } from "next/navigation";
import ReadinessCard from "./ReadinessCard";
import { UploadDrawer } from "./DocBits";
import type { ReadinessItem } from "@/lib/checklist";
import type { TenantOrgType } from "@/lib/living-voice";

export default function ReadinessView({ tenantName, readiness, computedAt, openItem, orgType, unlock }: {
  tenantName: string;
  readiness: { pct: number; items: ReadinessItem[] };
  computedAt: string | null;
  openItem: string | null;
  orgType: TenantOrgType;
  /** Set when the person was sent here by the Funding gate: name both keys that turn it. */
  unlock: { eligibilityDone: boolean; readinessRun: boolean } | null;
}) {
  const router = useRouter();
  const [uploadLayer, setUploadLayer] = useState<"I" | "II" | "III" | null>(null);
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Inven(s)tory Readiness</h2>
          <p>What funders usually ask for, and whether your Inven(s)tory already holds it. Anything missing says how to add it.</p>
        </div>
        <div className="spacer" />
      </div>
      {unlock && (
        <div className="rd-unlock" role="note">
          <b>Funding unlocks from here.</b>
          <span className={unlock.eligibilityDone ? "on" : ""}>{unlock.eligibilityDone ? "✓" : "○"} Eligibility questions answered{!unlock.eligibilityDone && <> · <a href="/funding-eligibility">answer them →</a></>}</span>
          <span className={unlock.readinessRun ? "on" : ""}>{unlock.readinessRun ? "✓" : "○"} A readiness check has run{!unlock.readinessRun && <> · use the button below</>}</span>
        </div>
      )}
      <ReadinessCard readiness={readiness} computedAt={computedAt} openKey={openItem}
        orgType={orgType} onUpload={layer => setUploadLayer(layer)} />
      {uploadLayer && <UploadDrawer tenantName={tenantName} initialLayer={uploadLayer} orgType={orgType}
        onClose={() => setUploadLayer(null)} onDone={() => router.refresh()} />}
    </div>
  );
}
