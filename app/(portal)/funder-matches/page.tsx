import { redirect } from "next/navigation";

/**
 * The page moved to /funding in the Funding split (patch 24, 11 Nov 2026):
 * one page, Grants and Funders modes. Old links, bookmarks and tour deep
 * links land here and are carried over with their query intact.
 */
export default async function FunderMatchesMoved({ searchParams }: { searchParams: Promise<{ view?: string; mode?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.mode) q.set("mode", sp.mode);
  if (sp.view) q.set("view", sp.view);
  const qs = q.toString();
  redirect(`/funding${qs ? `?${qs}` : ""}`);
}
