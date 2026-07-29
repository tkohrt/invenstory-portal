// Schema-shaped types — mirror the future SQL schema column-for-column.
// Phase 3 swaps mock-data for live queries; these shapes must not change casually.

export type Layer = "I" | "II" | "III";
export type DocStatus = "pending" | "processing" | "ready" | "failed";
export type DocKind = "pdf" | "docx" | "web" | "note" | "xlsx" | "audio";
export type Role = "client" | "admin";
export type ArtifactStatus = "none" | "pending" | "approved" | "stale";

export interface Tenant {
  id: string;
  name: string;
  slack_channel_id: string | null;
  created_at: string;
}

export interface AppUser {
  id: string;
  tenant_id: string | null; // null for For Granted admins
  email: string;
  full_name: string;
  role: Role;
  auth_id: string;
  created_at: string;
}

export interface Document {
  id: string;
  tenant_id: string;
  title: string;
  layer: Layer;
  storage_key: string;
  mime_type: string;
  doc_kind: DocKind;
  status: DocStatus;
  error_detail: string | null;
  ocr_applied: boolean;
  current_version: number;
  uploaded_by: string; // app_user id
  source: "client" | "for_granted";
  snippet: string; // derived preview (first chunk); denormalized for cards
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  tenant_id: string;
  version: number;
  storage_key: string;
  uploaded_by: string;
  created_at: string;
}

export interface DocumentTag {
  id: string;
  document_id: string;
  tenant_id: string;
  tag: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  tenant_id: string;
  chunk_index: number;
  text: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  embedding_model: string | null;
}

export interface ChatSession {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  tenant_id: string;
  role: "user" | "assistant";
  content: string;
  citations: string[]; // document ids
  created_at: string;
}

export interface ArtifactType {
  slug: string;
  name: string;
  description: string;
  prompt_ref: string;
  card_schema: Record<string, unknown>;
  corpus_filter: { layers?: Layer[]; tags?: string[] } | null;
}

export interface ArtifactSet {
  id: string;
  tenant_id: string;
  type_slug: string;
  status: ArtifactStatus;
  version: number;
  generated_at: string | null;
  reviewed_by: string | null;
  model_used: string | null;
  token_cost: number | null;
  gap_note: string | null;
}

export interface ArtifactCard {
  id: string;
  set_id: string;
  tenant_id: string;
  title: string;
  payload: Record<string, string>;
  citations: string[]; // document ids
  sort_order: number;
}

export interface AuditLog {
  id: string;
  actor_user_id: string;
  tenant_id: string | null;
  action: string;
  detail: string;
  created_at: string;
}
