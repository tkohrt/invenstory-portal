import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getPendingReviews } from "@/lib/server/data";
import AdminReviewsView from "@/components/AdminReviewsView";

export default async function ReviewsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/library");
  return <AdminReviewsView pending={await getPendingReviews()} />;
}
