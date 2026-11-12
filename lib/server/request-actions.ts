"use server";
// Resolving rows in the Requests inbox (patch 37). Admin-only: the inbox is
// For Granted's desk. Every resolution stamps who and when, which is the
// audit trail the inbox exists for.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";

export async function resolveRequestAction(input: {
  id: string;
  status: "done" | "dismissed" | "open";
  resolution?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  const id = String(input.id ?? "").slice(0, 40);
  if (!id) return { ok: false, error: "No request named." };
  const reopen = input.status === "open";
  // tenant-safe: admin-only action on the cross-tenant inbox, keyed by row id.
  const { error } = await db.from("client_request").update(
    reopen
      ? { status: "open", handled_by: null, handled_at: null, resolution: null }
      : {
          status: input.status, handled_by: s.user.id, handled_at: new Date().toISOString(),
          resolution: (input.resolution ?? "").trim().slice(0, 400) || null,
        },
  ).eq("id", id);
  if (error) { console.error("[requests] resolve failed", error); return { ok: false, error: "That did not save. Try again." }; }
  revalidatePath("/admin/reviews");
  return { ok: true };
}
