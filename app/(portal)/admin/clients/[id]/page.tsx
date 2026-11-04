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
  if (!data) notFound();
  return (
    <>
      {setup && <AdminSetupPanel tenantId={id} state={setup} ownerName={setupOwner} />}
      <ClientActivityView data={data} voice={voice} reader={reader} />
    </>
  );
}
