// Registry of TOGGLEABLE Workspace nav features. Each entry automatically gets
// the per-client admin visibility toggle (sidebar dot) and client-side route
// gating. To add a future toggleable Workspace item, add one entry here.
//
// NOTE: the Inven(s)tory (/invenstory) and Account (/account) are intentionally
// NOT listed — they are always visible to every client and cannot be toggled.
//
// NOTE: adding an entry here does NOT put it in the sidebar. The rendered nav is
// a separate hardcoded list (`workspaceNav` in components/Shell.tsx). Registering
// here without adding there gives a feature that gates correctly and is reachable
// by URL but has no link. Add to both.
export interface WorkspaceFeature {
  key: string; href: string; label: string; icon: string; defaultVisible: boolean;
}

export const WORKSPACE_FEATURES: WorkspaceFeature[] = [
  { key: "dashboard",      href: "/dashboard",      label: "Dashboard",              icon: "▤", defaultVisible: true },
  { key: "answer_library", href: "/answer-library", label: "Answer Library",         icon: "◎", defaultVisible: false },
  { key: "chat",           href: "/chat",           label: "Ask your Inven(s)tory",  icon: "✦", defaultVisible: true },
  { key: "drafts",         href: "/drafts",         label: "Grants In The Works",    icon: "✎", defaultVisible: true },
  { key: "eligibility",    href: "/funding-eligibility", label: "Funding Eligibility", icon: "◇", defaultVisible: true },
  // Funder matching against the Ledger. defaultVisible:false = hidden from
  // every client account until an admin turns it on for that client. For
  // Granted runs matches on the client's behalf in the meantime.
  { key: "funder_matches", href: "/funder-matches", label: "Funder Matches",   icon: "◈", defaultVisible: false },
];

export const WORKSPACE_FEATURE_MAP: Record<string, WorkspaceFeature> =
  Object.fromEntries(WORKSPACE_FEATURES.map(f => [f.key, f]));

// Which toggleable feature (if any) owns a given pathname — used to gate routes.
export function featureForPath(pathname: string): WorkspaceFeature | undefined {
  return WORKSPACE_FEATURES.find(f => pathname === f.href || pathname.startsWith(f.href + "/"));
}
