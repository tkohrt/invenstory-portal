import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getGardenState } from "@/lib/server/garden";
import GardenPanel from "@/components/GardenPanel";

export default async function PlantPage() {
  const session = await getSession();
  if (!session) redirect("/");
  const garden = await getGardenState(session.tenantId);
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Your plant</h2>
          <p>Your plant grows as your Inven(s)tory grows &mdash; and perks up whenever you add something new.</p>
        </div>
        <div className="spacer" />
      </div>
      <GardenPanel garden={garden} />
    </div>
  );
}
