// Where has it got to?
//
// Polled by whichever page started the work. Scoped to the caller's tenant, so
// a job id from another engagement reads as absent rather than as somebody
// else's progress.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getJob } from "@/lib/server/jobs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const job = await getJob(session.tenantId, id);
  if (!job) return NextResponse.json({ error: "no such job" }, { status: 404 });
  // A Search Profile job's detail is For Granted's working view of a client's
  // Inven(s)tory, which the page deliberately never sends to a client. Reading
  // it by id would be a way around that.
  if (job.kind === "search_profile" && session.role !== "admin") {
    return NextResponse.json({ error: "no such job" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
