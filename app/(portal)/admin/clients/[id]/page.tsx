// Admin, Client activity: one client, one month (Eastern time). For Granted only.
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getClientActivity } from "@/lib/server/activity-read";
import { isMonthKey } from "@/lib/activity";
import { monthKey } from "@/lib/usage-limits";
import ClientActivityView from "@/components/ClientActivityView";
import { getVoiceProfile } from "@/lib/server/voice-profile";
import { readerSwitchesFor } from "@/lib/server/reader";
import { getSetupState, ownerName } from "@/lib/server/setup";
import AdminSetupPanel from "@/components/AdminSetupPanel";
import WelcomeCard from "@/components/WelcomeCard";
import { db } from "@/lib/server/db";
import AdminChatFeedback from "@/components/AdminChatFeedback";
import { chatFeedback } from "@/lib/server/portal-guide";
import { isDemoTenant } from "@/lib/demo";
import RfpEngineCard from "@/components/RfpEngineCard";
import RfpScanCard, { type LastRun } from "@/components/RfpScanCard";
import { getRfpProfile } from "@/lib/server/rfp-run";
import { rfpEngineOn, getGovReadiness } from "@/lib/server/gov-readiness";
import { gateLines } from "@/lib/gov-readiness";
import { tenantIsBrain } from "@/lib/server/brain";

export default async function ClientActivityPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const [{ id }, { m }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const month = isMonthKey(m) ? m : monthKey(new Date());
  const [data, voice, reader] = await Promise.all([
    getClientActivity(id, month),
    // Auto-Draft patch 4. A failure here never takes the activity page down with it.
    getVoiceProfile(id).catch(() => null),
    // Document Reader switches (Phase 1). Likewise never fatal.
    readerSwitchesFor(id).catch(() => null),
  ]);
  // Company setup (patch 14). Absent before 0077 runs.
  const setup = await getSetupState(id).catch(() => null);
  const setupOwner = setup ? await ownerName(id, setup.ownerUserId).catch(() => null) : null;
  const feedback = await chatFeedback(id).catch(() => []);
  // The welcome screen (patch 43). Absent columns before 0090 never break the page.
  // tenant-safe: one tenant row by id, admin page.
  const { data: wRow } = await db.from("tenant").select("welcome_note, welcome_video_url").eq("id", id).maybeSingle();
  const w = (wRow as { welcome_note: string | null; welcome_video_url: string | null } | null) ?? null;
  // The RFP Engine switch (patch 53). Never fatal; not offered for the Brain.
  // tenant-safe: one tenant row by id, admin page.
  const { data: nameRow } = await db.from("tenant").select("name").eq("id", id).maybeSingle();
  const orgName = (nameRow as { name: string } | null)?.name ?? "this client";
  const [rfpOn, gov, brain] = await Promise.all([
    rfpEngineOn(id).catch(() => false),
    getGovReadiness(id).catch(() => ({ available: false as const, interest: null, answers: {}, updatedAt: null })),
    tenantIsBrain(id).catch(() => false),
  ]);
  // The RFP scan (patch 58): the profile it reads and its last run, when the engine is on.
  const rfpProfile = rfpOn ? await getRfpProfile(id).catch(() => null) : null;
  const { data: lastRfpRun } = rfpOn
    ? await db.from("rfp_run").select("started_at, status, trigger, candidates, scored, counts, new_ids").eq("tenant_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const lastRun: LastRun | null = lastRfpRun ? { ...(lastRfpRun as Omit<LastRun, "new_count"> & { new_ids: string[] }), new_count: ((lastRfpRun as { new_ids: string[] }).new_ids ?? []).length } : null;
  if (!data) notFound();
  return (
    <>
      {isDemoTenant(id) && (
        <div className="demo-banner">
          <strong>Demo account.</strong> This client is wiped back to day one on every client sign-in: setup and tours replay, and all documents, chats, cards, drafts and matches are deleted. Never file real client material here. Demo activity sends no team emails or Slack pings.
        </div>
      )}
      {setup && <AdminSetupPanel tenantId={id} state={setup} ownerName={setupOwner} />}
      <WelcomeCard tenantId={id} note={w?.welcome_note ?? ""} videoUrl={w?.welcome_video_url ?? ""} setupDone={setup?.status === "complete"} />
      {!brain && <RfpEngineCard tenantId={id} orgName={orgName} on={rfpOn} available={gov.available} interest={gov.interest} gates={gateLines(gov.answers)} />}
      {!brain && rfpOn && rfpProfile && <RfpScanCard tenantId={id} profile={rfpProfile.profile} available={rfpProfile.available} lastRun={lastRun} />}
      <AdminChatFeedback items={feedback} />
      <ClientActivityView data={data} voice={voice} reader={reader} />
    </>
  );
}
