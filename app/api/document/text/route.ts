import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getDocumentFullText } from "@/lib/server/data";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("documentId");
  if (!id) return NextResponse.json({ error: "documentId required" }, { status: 400 });
  const doc = await getDocumentFullText(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(doc);
}
