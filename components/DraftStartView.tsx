"use client";
// The triage page: new application, or an existing one.
import Link from "next/link";
import type { LastDraft } from "@/lib/server/draft-start";

function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 14) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString();
}

export default function DraftStartView({ tenantName, last }: { tenantName: string; last: LastDraft | null }) {
  return (
    <div className="ds">
      <h2>Draft an Application</h2>
      <p className="ds-lead">Are you starting a new application, or continuing one?</p>
      <div className="ds-choices">
        <Link className="ds-choice ds-primary" href="/draft/new">
          <strong>Create New Draft</strong>
          <span>Bring in a funder&rsquo;s application and answer it from {tenantName}&rsquo;s Story Cards.</span>
        </Link>
        <Link className="ds-choice" href="/drafts">
          <strong>Edit Existing Draft</strong>
          <span>Open an application in progress, its versions, or Standard Answers.</span>
        </Link>
      </div>
      {last && (
        <Link className="ds-continue" href={`/drafts/${last.id}`}>
          Continue: <strong>{last.title}</strong>{last.funder ? `, ${last.funder}` : ""} <span>(edited {ago(last.updatedAt)})</span>
        </Link>
      )}
    </div>
  );
}
