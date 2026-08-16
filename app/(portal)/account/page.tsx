import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant, getPrimaryContact, getClientStats } from "@/lib/server/data";
import AccountView from "@/components/AccountView";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const admin = session.role === "admin";
  // For a client this is their own org; for an admin it's the client they're
  // currently viewing (so the admin sees the account page as the client sees it).
  const [tenant, contact, stats] = await Promise.all([
    getTenant(session.tenantId),
    getPrimaryContact(session.tenantId),
    getClientStats(session.tenantId),
  ]);
  return (
    <AccountView
      fullName={session.user.full_name}
      email={session.user.email}
      role={session.role}
      orgName={tenant?.name ?? null}
      website={tenant?.website ?? null}
      contactName={contact}
      stats={stats}
    />
  );
}
