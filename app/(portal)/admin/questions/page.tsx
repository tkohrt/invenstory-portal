import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getAllQuestions } from "@/lib/server/data";
import AdminQuestionsView from "@/components/AdminQuestionsView";

export default async function AdminQuestionsPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  return <AdminQuestionsView questions={await getAllQuestions()} />;
}
