import "server-only";
// The Inven(s)tory Garden engine. Size = permanent growth (never shrinks);
// health = freshness (recoverable, floor at "thirsty" — never dead).
// Score/size/health are computed on read; only achievements + plant_state persist.
import { db } from "./db";
import type { GardenState, PlantHealth, PlantSpecies } from "@/lib/types";
import { getContentCoverage, readiness } from "./gap-agent";

const DAY = 86400000;

// Tie the plant to the Funding Eligibility + Inven(s)tory Readiness metrics.
// One place to tune the thresholds and weights.
const GARDEN_TUNING = {
  readinessThriveBar: 60,       // min Inven(s)tory Readiness % to allow a "thriving" plant
  eligibilityCompleteBar: 80,   // min eligibility-profile completeness % to allow "thriving"
  sizeReadinessWeight: 0.25,    // readiness % -> size points (0..25 at 100%)
  sizeEligibilityWeight: 0.05,  // eligibility % -> size points (0..5 at 100%)
  sizeVolumeCap: 6,             // small raw-volume floor so pre-analysis uploads still grow the plant
};

const POT_UNLOCKS: Record<string, string> = { docs_5: "glazed", docs_10: "mosaic", docs_20: "talavera", docs_50: "porcelain", age_1yr: "jade", grant_won: "raku" };
const TRINKET_UNLOCKS: Record<string, string> = { all_layers: "fg_flag", age_6mo: "gnome", docs_10: "mushroom", docs_20: "crane", grant_won: "funded_flag" };
const VARIEGATION_UNLOCKS: Record<string, string> = { answers_reviewed_5: "variegated", grant_won: "golden" };

export async function getGardenState(tenantId: string): Promise<GardenState> {
  const [{ data: docs }, { data: wc }, { data: plant }, { data: ach }, { data: drafts }, { data: answers }, { data: tenant }, covData, { data: elig }] = await Promise.all([
    db.from("document").select("layer, created_at").eq("tenant_id", tenantId).eq("status", "ready"),
    db.rpc("tenant_word_count", { p_tenant: tenantId }),
    db.from("plant_state").select("*").eq("tenant_id", tenantId).maybeSingle(),
    db.from("achievement").select("key, unlocked_at").eq("tenant_id", tenantId),
    db.from("grant_draft").select("status, updated_at").eq("tenant_id", tenantId),
    db.from("answer").select("source, status").eq("tenant_id", tenantId),
    db.from("tenant").select("created_at").eq("id", tenantId).single(),
    getContentCoverage(tenantId),
    db.from("eligibility_profile").select("completeness, org_type").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const D = docs ?? [];
  const words = Number(wc ?? 0);
  const layers = new Set(D.map(d => d.layer));
  const layersCovered = layers.size;
  const newest = D.length ? Math.max(...D.map(d => +new Date(d.created_at))) : null;
  const daysSince = newest ? Math.floor((Date.now() - newest) / DAY) : null;
  const newestL3 = D.filter(d => d.layer === "III").length ? Math.max(...D.filter(d => d.layer === "III").map(d => +new Date(d.created_at))) : null;
  const accountAgeDays = tenant ? Math.floor((Date.now() - +new Date(tenant.created_at)) / DAY) : 0;
  const dr = drafts ?? [];
  const reviewedAnswers = (answers ?? []).filter(a => a.source === "human").length;
  const answeredCount = (answers ?? []).length;

  // ---- achievements (compute + persist new) ----
  const have = new Set((ach ?? []).map(a => a.key));
  const earned: string[] = [];
  const check = (key: string, cond: boolean) => { if (cond && !have.has(key)) earned.push(key); };
  check("first_doc", D.length >= 1);
  check("docs_5", D.length >= 5); check("docs_10", D.length >= 10);
  check("docs_20", D.length >= 20); check("docs_50", D.length >= 50);
  check("all_layers", layersCovered === 3);
  check("first_interview", D.some(d => d.layer === "III"));
  check("age_6mo", accountAgeDays >= 182); check("age_1yr", accountAgeDays >= 365);
  check("answers_reviewed_5", reviewedAnswers >= 5);
  check("grant_submitted", dr.some(d => ["submitted", "won", "lost"].includes(d.status)));
  check("grant_won", dr.some(d => d.status === "won"));

  // ---- readiness + eligibility signals (read from cache; cheap, no agent re-run) ----
  const orgType = (elig?.org_type as string | null) ?? null;
  const analyzed = covData.computedAt != null;
  const R = analyzed ? readiness(orgType, covData.cov) : null;
  const readinessPct = R?.pct ?? 0;
  const essentialAllCovered = R ? R.items.filter(i => i.tier === "essential").every(i => i.state === "covered") : false;
  const eligibilityPct = Number(elig?.completeness ?? 0);

  // ---- growth points -> size (readiness-weighted; ratcheted so it never shrinks) ----
  // A robust, fundable Inven(s)tory drives size; raw uploads only float the pre-analysis floor.
  const growthPoints =
    readinessPct * GARDEN_TUNING.sizeReadinessWeight +
    eligibilityPct * GARDEN_TUNING.sizeEligibilityWeight +
    2 * layersCovered +
    Math.min(GARDEN_TUNING.sizeVolumeCap, D.length) +
    0.5 * (have.size + earned.length);
  const candidateSize: 1 | 2 | 3 = growthPoints >= 25 ? 3 : growthPoints >= 10 ? 2 : 1;
  const sizeFloor: 1 | 2 | 3 = have.has("size_3") ? 3 : have.has("size_2") ? 2 : 1; // high-water mark via persisted achievements
  const size: 1 | 2 | 3 = (Math.max(candidateSize, sizeFloor) as 1 | 2 | 3);
  check("size_2", size >= 2); check("size_3", size >= 3);

  if (earned.length) {
    await db.from("achievement").insert(earned.map(key => ({ tenant_id: tenantId, key })));
  }
  const allKeys = [...have, ...earned];

  // ---- health (freshness; L3 staleness drops one band) ----
  let health: PlantHealth = daysSince === null ? "thirsty" : daysSince <= 45 ? "thriving" : daysSince <= 90 ? "okay" : "thirsty";
  const l3Stale = newestL3 === null || (Date.now() - newestL3) / DAY > 180;
  if (l3Stale && health === "thriving") health = "okay";
  else if (l3Stale && health === "okay") health = "thirsty";

  // ---- substance cap: "thriving" also requires a robust, fundable Inven(s)tory ----
  // Only applies once analyzed, so an un-analyzed tenant keeps today's freshness-only behavior
  // (never demoted for a metric that hasn't been computed yet). Floors at "okay" — never "thirsty".
  if (analyzed && health === "thriving") {
    const substanceOK = essentialAllCovered || readinessPct >= GARDEN_TUNING.readinessThriveBar;
    const eligibilityOK = eligibilityPct >= GARDEN_TUNING.eligibilityCompleteBar;
    if (!(substanceOK && eligibilityOK)) health = "okay";
  }

  // ---- score ----
  const coverage = layersCovered * 10;
  const volume = Math.min(25, D.length * 2);
  const fresh = health === "thriving" ? 30 : health === "okay" ? 20 : 8;
  const ansScore = answeredCount > 0 ? Math.round(15 * Math.min(1, reviewedAnswers / Math.max(5, answeredCount * 0.5))) : 0;
  const score = Math.min(100, coverage + volume + fresh + ansScore + (answeredCount === 0 ? Math.min(10, D.length) : 0));

  // ---- bloom (real wins) ----
  const recently = (s: string[], days: number) => dr.some(d => s.includes(d.status) && (Date.now() - +new Date(d.updated_at)) / DAY <= days);
  const bloom: GardenState["bloom"] = recently(["won"], 30) ? "flower" : recently(["submitted"], 14) ? "bud" : "none";

  // ---- unlocks ----
  const unlocks = {
    pots: ["terracotta", ...allKeys.map(k => POT_UNLOCKS[k]).filter(Boolean)],
    trinkets: allKeys.map(k => TRINKET_UNLOCKS[k]).filter(Boolean),
    variegations: allKeys.map(k => VARIEGATION_UNLOCKS[k]).filter(Boolean),
  };

  // ---- prompt engine (deterministic rotation by day + doc count) ----
  const seed = Math.floor(Date.now() / DAY) + D.length;
  const pick = (arr: string[]) => arr[seed % arr.length];
  const speciesName: Record<PlantSpecies, string> = { pothos: "Pothos", monstera: "Monstera", spider: "Spider Plant" };
  const sp = (plant?.species as PlantSpecies) ?? "pothos";
  let prompt: GardenState["prompt"];
  if (analyzed && R) {
    // Retargeted prompts: point at the actual Readiness gaps + eligibility, highest-value first.
    const itemPrompt = (i: { key: string; label: string }, variants: string[]): GardenState["prompt"] =>
      ({ text: pick(variants).replace("{item}", i.label), layer: null, itemKey: i.key, target: "invenstory" });
    const findItem = (tier: string, state: string) => R.items.find(i => i.tier === tier && i.state === state);
    if (!orgType) {
      prompt = { text: pick([
        "You can't be matched to funders yet — set your organization type to unlock eligibility.",
        "One field stands between you and funder matches: set your organization type.",
        "Funders are filtered by organization type. Add it and your matches light up."]), layer: null, target: "eligibility" };
    } else {
      const missEss = findItem("essential", "missing");
      const thinEss = findItem("essential", "thin");
      const missImp = findItem("important", "missing");
      const enr = findItem("enriching", "missing") ?? findItem("enriching", "thin");
      if (missEss) prompt = itemPrompt(missEss, [
        "Your Inven(s)tory is missing its {item} — an Essential funders almost always ask for.",
        "Add your {item} to reach a robust Inven(s)tory.",
        "Grow your roots: {item} is a funder Essential you don't have yet."]);
      else if (thinEss) prompt = itemPrompt(thinEss, [
        "Your {item} is thin — a few more specifics would make it fundable.",
        "Strengthen your {item}: funders reward detail over presence.",
        "Almost there on {item} — add a bit more and it turns robust."]);
      else if (missImp) prompt = itemPrompt(missImp, [
        "Deepen your story — add your {item} to strengthen your Inven(s)tory.",
        "{item} isn't required, but it's what sets strong applications apart.",
        "Add your {item} to round out a strong Inven(s)tory."]);
      else if (eligibilityPct < GARDEN_TUNING.eligibilityCompleteBar) prompt = { text: pick([
        `Your eligibility profile is ${Math.round(eligibilityPct)}% complete — finish it to sharpen your funder matches.`,
        "A few more eligibility fields and you're ready to be matched.",
        "Complete your eligibility profile to unlock sharper funder matches."]), layer: null, target: "eligibility" };
      else if (daysSince !== null && daysSince > 60) prompt = { text: pick([
        `Your ${speciesName[sp]} looks thirsty — a recent upload keeps your Inven(s)tory current.`,
        `Time to water: nothing new in ${daysSince} days. A quick upload perks your ${speciesName[sp]} right up.`,
        "Freshness fading — add a recent document to keep your Inven(s)tory robust."]), layer: null, target: "invenstory" };
      else if (newestL3 !== null && (Date.now() - newestL3) / DAY > 90) prompt = itemPrompt({ key: "founder_voice", label: "living voice" }, [
        "Keep the living voice living — add a fresh Layer III note to stay robust.",
        "Your Layer III is quieting down. A monthly update keeps it green.",
        "Feed the soul layer: add a recent transcript or update."]);
      else if (enr) prompt = itemPrompt(enr, [
        "Everything essential is in. Add your {item} to make the story shine.",
        "Your Inven(s)tory is strong — {item} would make it stand out.",
        "Add your {item} to deepen an already-robust Inven(s)tory."]);
      else prompt = { text: pick([
        "Your Inven(s)tory is robust and fundable — keep it fresh as things change.",
        "Beautiful garden. Add this quarter's updates to keep it thriving.",
        "Everything's green. New documents keep the story compounding."]), layer: null, target: "invenstory" };
    }
  } else {
  const missing: ("I" | "II" | "III")[] = (["I", "II", "III"] as const).filter(L => !layers.has(L));
  const nextDocMilestone = [5, 10, 20, 50].find(n => D.length < n);
  if (missing.length) {
    const L = missing[0];
    const byLayer: Record<string, string[]> = {
      I: ["Plant your public story — add your website capture, an annual report, or press to Layer I.",
          "Every garden starts with soil: seed Layer I with your public story documents.",
          "Water your Inven(s)tory — Layer I is waiting for your first public-story document."],
      II: ["Water your Inven(s)tory — upload a strategic plan, board deck, or budget to Layer II.",
          "Grow deeper roots: add your first internal-strategy document to Layer II.",
          "Your story has a public face — give it an operational core. Add a Layer II document."],
      III: ["Grow your roots — contribute a meeting transcript or a self-interview to Layer III.",
          "The soul layer is empty: record a quick self-interview and add it to Layer III.",
          "Add a living voice — upload an interview or meeting transcript to Layer III."],
    };
    prompt = { text: pick(byLayer[L]), layer: L };
  } else if (daysSince !== null && daysSince > 60) {
    prompt = { text: pick([
      `Your ${speciesName[sp]} looks thirsty — it's been ${daysSince} days since your last upload.`,
      `Time to water: nothing new in ${daysSince} days. A quick upload perks your ${speciesName[sp]} right up.`,
      `Freshness fading — add a recent document and watch your ${speciesName[sp]} recover.`]), layer: null };
  } else if (newestL3 !== null && (Date.now() - newestL3) / DAY > 90) {
    prompt = { text: pick([
      "Keep the living voice living — add a quarterly update or meeting transcript to Layer III.",
      "Your Layer III is quieting down. A monthly update email or self-interview keeps it green.",
      "Feed the soul layer: contribute a fresh transcript or business update to Layer III."]), layer: "III" };
  } else if (nextDocMilestone) {
    const need = nextDocMilestone - D.length;
    prompt = { text: pick([
      `${need} document${need === 1 ? "" : "s"} from your next growth milestone — keep cultivating.`,
      `Grow your Inven(s)tory — ${need} more upload${need === 1 ? "" : "s"} reaches a milestone (and a new pot).`,
      `Almost there: ${need} more document${need === 1 ? "" : "s"} and your plant hits its next milestone.`]), layer: null };
  } else {
    prompt = { text: pick([
      "Your Inven(s)tory is flourishing — keep it fresh with your latest updates.",
      "Beautiful garden. Add this quarter's updates to keep it thriving.",
      "Everything's green. New documents keep the story compounding."]), layer: null };
  }
  }

  return {
    species: (plant?.species as PlantSpecies) ?? null, size, health, score,
    pot: plant?.pot ?? "terracotta", trinket: plant?.trinket ?? null,
    variegation: plant?.variegation ?? null, hidden: plant?.hidden ?? false,
    bloom, achievements: (ach ?? []).concat(earned.map(k => ({ key: k, unlocked_at: new Date().toISOString() }))),
    newAchievements: earned, unlocks, prompt,
    stats: { docs: D.length, words, layersCovered, daysSinceUpload: daysSince },
  };
}

// Light, read-only summaries for the admin greenhouse (no achievement writes).
export interface GardenSummary { tenantId: string; species: PlantSpecies; size: 1 | 2 | 3; health: PlantHealth; hidden: boolean; pot: string; trinket: string | null; variegation: string | null }
export async function getGardenSummaries(): Promise<Record<string, GardenSummary>> {
  const [{ data: tenants }, { data: docs }, { data: plants }, { data: achs }] = await Promise.all([
    db.from("tenant").select("id"),
    db.from("document").select("tenant_id, layer, created_at").eq("status", "ready"),  // tenant-safe: admin greenhouse cross-tenant aggregate
    db.from("plant_state").select("*"),  // tenant-safe: admin greenhouse cross-tenant aggregate
    db.from("achievement").select("tenant_id"),  // tenant-safe: admin greenhouse cross-tenant aggregate
  ]);
  const out: Record<string, GardenSummary> = {};
  for (const t of tenants ?? []) {
    const D = (docs ?? []).filter(d => d.tenant_id === t.id);
    const plant = (plants ?? []).find(p => p.tenant_id === t.id);
    const nAch = (achs ?? []).filter(a => a.tenant_id === t.id).length;
    const layers = new Set(D.map(d => d.layer)).size;
    const gp = D.length + 2 * layers + nAch; // words omitted in light mode
    const size: 1 | 2 | 3 = gp >= 25 ? 3 : gp >= 10 ? 2 : 1;
    const newest = D.length ? Math.max(...D.map(d => +new Date(d.created_at))) : null;
    const days = newest ? (Date.now() - newest) / DAY : null;
    const health: PlantHealth = days === null ? "thirsty" : days <= 45 ? "thriving" : days <= 90 ? "okay" : "thirsty";
    out[t.id] = { tenantId: t.id, species: (plant?.species as PlantSpecies) ?? "pothos", size, health, hidden: plant?.hidden ?? false, pot: plant?.pot ?? "terracotta", trinket: plant?.trinket ?? null, variegation: plant?.variegation ?? null };
  }
  return out;
}
