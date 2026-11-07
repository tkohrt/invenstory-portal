// The Demo Client (7 November 2026, agreed with Tyler in chat).
//
// A demo tenant replays the whole first-time experience on EVERY client
// sign-in: company setup from a blank start, every first-use tour, and an
// empty Inven(s)tory. The reset is a full wipe (documents, chats, cards,
// drafts, matches, analysis), so each demo is identical and nothing
// accumulates across runs. Logins, settings (features, allowance, sources),
// AI spend records and the audit log are kept.
//
// Which tenants are demos is set by the DEMO_TENANT_IDS environment variable
// in Vercel: comma-separated tenant UUIDs. Unset means no tenant is a demo
// and none of this runs. A demo tenant also sends no team notifications
// (email or Slack), so demo runs never page For Granted.
//
// Pure and free of `server-only`; the wipe itself is lib/server/demo.ts.
// Tested in tests/portal/demo.test.ts.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The demo tenant ids, from DEMO_TENANT_IDS (comma-separated UUIDs). */
export function demoTenantIds(env: string | undefined = process.env.DEMO_TENANT_IDS): string[] {
  return (env ?? "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(s => UUID.test(s));
}

/** Is this tenant a demo tenant? False for null/undefined and when the variable is unset. */
export function isDemoTenant(tenantId: string | null | undefined, env?: string): boolean {
  if (!tenantId) return false;
  return demoTenantIds(env).includes(tenantId.toLowerCase());
}

/**
 * Every table the wipe clears for the demo tenant, in deletion order:
 * referencing tables before the tables they reference (most content links
 * cascade or set null, but client_ask points at document with neither, so
 * order still matters). Deliberately NOT here, and so kept across resets:
 * app_user (the demo logins), audit_log (history, including each reset),
 * feature_visibility, ai_allowance, match_source_setting (For Granted's
 * configuration of the demo account), ai_usage and usage_grant (real AI
 * spend and grants, kept for cost tracking), and the tenant row itself.
 */
export const DEMO_WIPE_TABLES: readonly string[] = [
  // Leaves and cross-references first.
  "client_ask", "chunk_embedding", "answer_citation", "answer_event",
  "story_card_evidence", "story_card_doc", "story_card_variant", "story_card_version",
  "card_event", "section_block", "question_observation", "figure_clearance",
  "draft_form_item", "draft_context", "draft_snapshot",
  "client_match_view", "match_triage", "discovered_lead", "job_event",
  "analysis_review", "analysis_dup_review", "analysis_verdict",
  "analysis_suggestion_decision", "analysis_usage", "analysis_request", "analysis_client_state",
  "card_refusal", "guide_question", "usage_request", "activity_event",
  "profile_edit", "achievement", "artifact_card", "search_profile_doc", "chat_message",
  // Their parents.
  "answer", "document_chunk", "document_text", "document_version", "document_tag",
  "story_card", "draft_section", "matched_funder", "analysis_doc",
  "artifact_set", "chat_session", "discovery_run", "job", "eligible_grant",
  // Top-level content and state.
  "grant_draft", "document", "match_run", "eligibility_gap", "eligibility_profile",
  "search_profile", "plant_state", "voice_profile", "tenant_setup",
];

/**
 * A ui_prefs key the reset clears, so tours replay and the "don't ask again"
 * boxes come back: tour_* (seen tours) and confirm_* (remove/weave reminders).
 */
export function isFirstRunPrefKey(key: string): boolean {
  return key.startsWith("tour_") || key.startsWith("confirm_");
}

/** ui_prefs with the first-run keys removed; null when nothing is left. */
export function stripFirstRunPrefs(prefs: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const kept = Object.entries(prefs ?? {}).filter(([k]) => !isFirstRunPrefKey(k));
  return kept.length ? Object.fromEntries(kept) : null;
}
