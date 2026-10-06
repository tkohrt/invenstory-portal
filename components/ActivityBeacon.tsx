"use client";
// Tells the portal which part of it a client login is using, as the page
// changes (client activity, patch 2). The server records at most one row per
// person per part every 30 minutes, keeps only the path with ids removed, and
// ignores For Granted's own logins. Nothing is shown and nothing waits on it.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ActivityBeacon({ enabled }: { enabled: boolean }) {
  const path = usePathname();
  useEffect(() => {
    if (!enabled || !path) return;
    try {
      void fetch("/api/activity", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }), keepalive: true,
      }).catch(() => undefined);
    } catch { /* never in the way */ }
  }, [enabled, path]);
  return null;
}
