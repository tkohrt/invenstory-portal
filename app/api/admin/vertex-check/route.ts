import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { runVertexCheck } from "@/lib/server/vertex-check";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });
  const model = new URL(req.url).searchParams.get("model") ?? undefined;
  return NextResponse.json(await runVertexCheck(model));
}
