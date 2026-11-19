"use client";
// The "Not yet reviewed by For Granted" label (patch 67), with its
// explanation one press away (patch 68). It was hover text only, which a
// keyboard or a phone cannot reach. The label is a button; pressing it shows
// the sentence underneath, and pressing again hides it.
import { useId, useState } from "react";
import { UNREVIEWED_LABEL, UNREVIEWED_WHY } from "@/lib/trust";

export default function UnreviewedTag() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="ur-wrap">
      <button type="button" className="ov-tag gt-pending ur-tag" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(o => !o)}>{UNREVIEWED_LABEL} <span aria-hidden="true">{open ? "▾" : "▸"}</span><span className="sr-only">{open ? " (hide what this means)" : " (what this means)"}</span></button>
      {open && <span id={id} className="ur-why">{UNREVIEWED_WHY}</span>}
    </span>
  );
}
