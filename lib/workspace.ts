// Registry of TOGGLEABLE Workspace nav features. Each entry automatically gets
// the per-client admin visibility toggle (sidebar dot) and client-side route
// gating. To add a future toggleable Workspace item, add one entry here.
//
// NOTE: the Inven(s)tory (/invenstory) and Account (/account) are intentionally
// NOT listed — they are always visible to every client and cannot be toggled.
export interface WorkspaceFeature {
  key: string; href: string; label: string; icon: string; defaultVisible: boolean;
}

export const WORKSPACE_FEATURES: WorkspaceFeature[] = [
  { key: "dashboard",      href: "/dashboard",      label: "Dashboard",              icon: "▤", defaultVisible: true },
  { key: "answer_library", href: "/answer-library", label: "Answer Library",         icon: "◎", defaultVisible: false },
  { key: "chat",           href: "/chat",           label: "Ask your Inven(s)tory",  icon: "✦", defaultVisible: true },
  { key: "drafts",         href: "/drafts",         label: "Grants In The Works",    icon: "✎", defaultVisible: true },
];

export const WORKSPACE_FEATURE_MAP: Record<string, WorkspaceFeature> =
  Object.fromEntries(WORKSPACE_FEATURES.map(f => [f.key, f]));

// Which toggleable feature (if any) owns a given pathname — used to gate routes.
export function featureForPath(pathname: string): WorkspaceFeature | undefined {
  return WORKSPACE_FEATURES.find(f => pathname === f.href || pathname.startsWith(f.href + "/"));
}
