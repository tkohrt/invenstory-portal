import "server-only";
// What a client takes with them: their Story Cards and their approved answers.
//
// Clients' agreements say their material is theirs when an engagement ends, and
// the Inven(s)tory has always downloaded as a .zip. These two are the rest of
// it: every card with the quote and document behind it, and every answer in the
// Answer Library. Read through userClient, so a client gets exactly its own
// (0043 lets a client read its cards) and an admin gets the client being viewed.
import { userClient } from "./supabase";
import { CARD_KIND_MAP } from "@/lib/story-card";
import { CLEARANCE_LABEL, type SensitiveClearance } from "@/lib/card-sensitivity";

const cell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function cardsCsv(tenantId: string): Promise<{ csv: string; count: number }> {
  const s = await userClient();
  const { data, error } = await s.from("story_card")
    .select("kind, statement, status, layer, strength, statement_origin, version, verified_by_role, retired_reason, retired_note, "
      + "sensitive, sensitive_cleared, created_at, story_card_evidence(quote, document:document_id(title))")
    .eq("tenant_id", tenantId).order("kind").order("created_at");
  if (error) throw new Error(`Could not read the cards: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const head = ["Kind", "Statement", "Status", "Layer", "Evidence", "Edited by a person", "Version",
    "Sensitive", "Retired because", "Sources (document: quote)"];
  const lines = [head.join(",")];
  for (const r of rows) {
    const ev = ((r.story_card_evidence as { quote: string; document: { title: string } | null }[]) ?? [])
      .map(e => `${e.document?.title ?? "a document no longer available"}: "${e.quote}"`).join("\n");
    const status = r.status === "verified" ? (r.verified_by_role === "client" ? "Confirmed by you" : "Verified")
      : r.status === "retired" ? "Retired" : "Not yet checked";
    const sens = r.sensitive ? (r.sensitive_cleared ? CLEARANCE_LABEL[r.sensitive_cleared as SensitiveClearance] : "Awaiting a decision") : "";
    const retired = r.status === "retired"
      ? [r.retired_reason === "superseded" ? "out of date" : r.retired_reason, r.retired_note].filter(Boolean).join(": ") : "";
    lines.push([
      CARD_KIND_MAP[r.kind as string]?.label ?? r.kind, r.statement, status, r.layer ?? "",
      r.strength === "covered" ? "Specific" : "General", r.statement_origin === "human" ? "Yes" : "No", r.version,
      sens, retired, ev,
    ].map(cell).join(","));
  }
  // A byte-order mark, so Excel opens the file as UTF-8 and curly quotes survive.
  return { csv: "﻿" + lines.join("\r\n"), count: rows.length };
}

export async function answersMarkdown(tenantId: string, orgName: string): Promise<{ md: string; count: number }> {
  const s = await userClient();
  const { data, error } = await s.from("answer")
    .select("short_answer, long_answer, status, source, reviewed_at, updated_at, question:question_id(category, prompt_text, sort_order), "
      + "answer_citation(snippet, document:document_id(title))")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`Could not read the answers: ${error.message}`);
  type Row = { short_answer: string | null; long_answer: string | null; status: string; source: string; reviewed_at: string | null;
    question: { category: string; prompt_text: string; sort_order: number } | null;
    answer_citation: { snippet: string | null; document: { title: string } | null }[] };
  const rows = ((data ?? []) as unknown as Row[]).filter(r => r.long_answer || r.short_answer)
    .sort((a, b) => (a.question?.sort_order ?? 0) - (b.question?.sort_order ?? 0));
  const out = [`# ${orgName}: Answer Library`, "", `Exported ${new Date().toISOString().slice(0, 10)}. ${rows.length} answer(s).`, ""];
  for (const r of rows) {
    out.push(`## ${r.question?.category ?? "Question"}`, "", `*${r.question?.prompt_text ?? ""}*`, "");
    out.push(r.status === "published" ? `Approved${r.reviewed_at ? ` ${r.reviewed_at.slice(0, 10)}` : ""}.` : "Draft, not yet approved.", "");
    out.push(r.long_answer ?? r.short_answer ?? "", "");
    const docs = [...new Set((r.answer_citation ?? []).map(c => c.document?.title).filter(Boolean))];
    if (docs.length) out.push(`Sources: ${docs.join("; ")}`, "");
  }
  return { md: out.join("\n"), count: rows.length };
}
