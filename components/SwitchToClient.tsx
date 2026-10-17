"use client";
// For Granted opening a document that belongs to a client other than the one
// being viewed: switch first, so everything on the page is that client's.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/lib/server/actions";

export default function SwitchToClient({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="empty">
      <p>This document belongs to {tenantName}, not the client you are viewing.</p>
      <button type="button" className="sb-btn sb-primary" disabled={busy}
        onClick={async () => { setBusy(true); await switchTenantAction(tenantId); router.refresh(); }}>
        {busy ? "Switching…" : `Switch to ${tenantName}`}
      </button>
    </div>
  );
}
