// The Requests inbox (patch 37): shapes shared between the server module
// (lib/server/requests.ts) and the client view (AdminRequestsView), which a
// "use client" file can import without dragging in server-only code.
export interface ClientRequest {
  id: string;
  tenant_id: string | null;
  kind: string;
  detail: string;
  source_key: string | null;
  created_at: string;
  status: "open" | "seen" | "done" | "dismissed";
  handled_at: string | null;
  resolution: string | null;
  tenant_name?: string | null;
  handled_by_name?: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  request: "Client request",
  profile_flag: "Profile fact flagged",
  profile_removal: "Profile fact removed",
  upload: "Upload",
  closure: "Account closure",
  allowance: "More allowance asked",
  allowance_alert: "Allowance threshold",
  answer: "Client answered",
  draft_request: "Draft requested",
  website_lead: "Website lead",
};
