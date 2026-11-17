import "server-only";
// The model call for RFP fit (patch 54). Prompt and parsing: lib/rfp-fit-prompt.ts.
import { chatComplete } from "./llm";
import { FIT_SYSTEM, fitUserPrompt, parseFitReply, noticeTextOf, type FitReply } from "@/lib/rfp-fit-prompt";
import type { RfpNoticeInput, Stage } from "@/lib/rfp-rubric";

/**
 * Judge one notice's fit. Null when generation is not configured or the reply
 * could not be read twice running: the caller then leaves the notice unscored
 * rather than guessing.
 */
export async function judgeFit(profile: string, n: RfpNoticeInput, stage: Stage): Promise<FitReply | null> {
  const user = fitUserPrompt(profile, n, stage);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chatComplete({ system: FIT_SYSTEM, user, maxTokens: 600, temperature: 0 });
    if (!r) return null;
    const parsed = parseFitReply(r.text, profile, noticeTextOf(n));
    if (parsed) return parsed;
  }
  return null;
}
