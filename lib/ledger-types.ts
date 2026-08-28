// Shapes the Funder Ledger service returns. Kept free of `server-only` so the
// pure screening logic (and its tests) can use them without pulling in the
// server client.

export const LEDGER_AS_OF = "June 2026";

export interface FunderCard {
  name: string; ein: string; funder_type?: string; location?: string;
  typical_grant_range?: string; focus?: string; mission?: string; website?: string;
  has_grant_history?: boolean; grants_on_record?: number; total_granted_usd?: number;
  match_reason?: string; confidence?: "strong" | "moderate" | "worth_a_look";
  caveat?: string;                       // pass-through vehicles (DAFs); relay verbatim
  evidence_grantees?: { name: string; amount_usd?: number; years?: number[] }[];
}

export interface GrantCard {
  title?: string; name?: string; opportunity_number?: string;
  agency?: string; eligibility?: string; close_date?: string;
  min_award?: number; max_award?: number; award_ceiling?: number;
  website?: string; match_reason?: string;
  confidence?: "strong" | "moderate" | "worth_a_look"; caveat?: string;
}

export interface LedgerEnvelope<T> {
  results: T[]; as_of?: string; verify?: string; note?: string; suggestions?: string[];
}
