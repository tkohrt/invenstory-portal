"use client";
// A link into a client's own pages (a draft, their Inven(s)tory) from an admin
// view. Those pages show whichever client For Granted is viewing, so this
// switches to the client first, then opens the page.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/lib/server/actions";

export default function OpenAsClient({ tenantId, href, children, className = "fc-link" }: {
  tenantId: string; href: string; children: React.ReactNode; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy} aria-busy={busy}
      onClick={async () => { setBusy(true); try { await switchTenantAction(tenantId); router.push(href); router.refresh(); } finally { setBusy(false); } }}>
      {busy ? "Opening…" : children}
    </button>
  );
}
