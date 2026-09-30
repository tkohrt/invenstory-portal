// Answer Library generation: PAUSED on 30 September 2026.
//
// The Answer Library will be built from the Card Library in the drafter's
// Standard Answers (Story Card Drafter spec, section 16), where every sentence
// traces to a verified quote. The generator this route called summarised
// retrieved passages with no such check. It answers 410 Gone rather than
// running, and the generator code is removed once Phase 3 ships.
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Answer generation is paused while the Answer Library moves to Story Cards." },
    { status: 410 },
  );
}
