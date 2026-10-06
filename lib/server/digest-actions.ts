"use server";
// Admin, All Clients, Monday digest: send it now (client activity, patch 3).
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { gatherDigest, sendDigest } from "./digest";

export async function sendDigestNowAction() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("For Granted only.");
  const sent = await sendDigest(await gatherDigest(new Date()), { actorUserId: s.user.id });
  revalidatePath("/admin/clients/digest");
  return sent;
}
