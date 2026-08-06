import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant, getPrimaryContact } from "@/lib/server/data";
import AccountView from "@/components/AccountView";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const isClient = session.role === "client";
  const [tenant, contact] = await Promise.all([
    isClient ? getTenant(session.tenantId) : Promise.resolve(null),
    isClient ? getPrimaryContact(session.tenantId) : Promise.resolve(null),
  ]);
  return (
    <AccountView
      fullName={session.user.full_name}
      email={session.user.email}
      role={session.role}
      orgName={tenant?.name ?? null}
      website={tenant?.website ?? null}
      contactName={contact}
    />
  );
}
