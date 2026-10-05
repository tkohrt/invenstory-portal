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
  { key: "chat",           href: "/chat",           label: "Ask your Inven(s)tory",  icon: "✦", defaultVisible: true },
  // Every draft and its versions. Off for every client until there is a
  // client-facing view of the Storyboarding Tool: today its drafts are For
  // Granted only, so a client would only ever see an empty page. (Draft an
  // Application, the tool's front door, is admin-only and not a toggle.)
  { key: "drafts",         href: "/drafts",         label: "Drafts",                 icon: "✎", defaultVisible: false },
  { key: "eligibility",    href: "/funding-eligibility", label: "Funding Eligibility", icon: "◇", defaultVisible: true },
  // Funder matching against the Ledger. defaultVisible:false = hidden from
  // every client account until an admin turns it on for that client. For
  // Granted runs matches on the client's behalf in the meantime.
  { key: "funder_matches", href: "/funder-matches", label: "Funder Matches",   icon: "◈", defaultVisible: false },
  // The client's own Story Cards, to verify, correct or mark out of date in
  // short batches (Phase 3.1). Hidden until an admin turns it on for a client,
  // like Funder Matches: Decision 1 of the drafter spec kept cards For Granted's
  // view in version 1, and this is the deliberate step past it.
  { key: "card_review",    href: "/story-cards",    label: "Story Cards",      icon: "▣", defaultVisible: false },
  // Inven(s)tory Analysis, Phase C: the client's own Analyze button, with the
  // fair-use cap and the request path, and the eligibility answers to confirm.
  // Hidden for every client until For Granted turns it on, which should wait
  // for that client's Review and Compare gates and for Phase D (until then the
  // rest of the portal still shows the current readiness).
  { key: "analysis",       href: "/analysis",       label: "Analyze my Inven(s)tory", icon: "◎", defaultVisible: false },
];

export const WORKSPACE_FEATURE_MAP: Record<string, WorkspaceFeature> =
  Object.fromEntries(WORKSPACE_FEATURES.map(f => [f.key, f]));

