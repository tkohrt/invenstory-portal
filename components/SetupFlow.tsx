"use client";
// Company setup on first sign-in (patch 14, onboarding build, 3 November 2026).
// Built to the agreed mockup "Portal Setup and Tours Mockup": eight steps, a
// step rail, one primary button per screen, and a way out of every step.
// Rules in lib/setup.ts; writes in lib/server/setup-actions.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SETUP_STEPS, ROLES, RELATIONSHIPS, GOALS, canSettle, resumeAt, stepsSettled,
  type SetupState, type SetupStepKey, type KnownFunder, type Deadline, type Goal,
} from "@/lib/setup";
import {
  saveYouAction, saveSetupEligibilityAction, addSetupLinkAction, markLayer3ReadAction, requestInterviewAction,
  saveFundingSoFarAction, saveTeamAction, settleStepAction, finishSetupAction, suggestFundersAction,
} from "@/lib/server/setup-actions";
import { signOutAction } from "@/lib/server/actions";
import { ORG_TYPES, BUDGET_BANDS, FEDERAL_REG, MATCH_CAPACITY, FUNDING_KINDS, type EligibilityProfile } from "@/lib/eligibility-fields";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { TagField, CountryField } from "./FundingEligibilityView";
import LivingVoicePrompts from "./LivingVoicePrompts";
import { ACCEPT_ATTR, ACCEPTED_LABEL, SUPPORT_EMAIL, isAccepted } from "@/lib/uploads";
import { browserClient } from "@/lib/supabase-browser";
import type { TenantOrgType } from "@/lib/living-voice";

export interface SetupDoc { id: string; title: string; layer: string; status: string; typeTag?: string | null }

/** One readiness-checklist item with its live coverage (P1, patch 29). */
export interface GroceryItem { key: string; label: string; tier: "essential" | "important" | "enriching"; state: "covered" | "thin" | "missing" }

interface Props {
  tenantName: string;
  orgType: TenantOrgType;
  website: string | null;
  fullName: string;
  email: string;
  state: SetupState;
  profile: EligibilityProfile;
  docs: SetupDoc[];
  /** The readiness grocery list, re-read as documents process. */
  grocery?: GroceryItem[];
  /** Goals whose tool is on for this client. */
  goals: Goal[];
  /** Tools switched on for this client. */
  tools: { chat: boolean; funder_matches: boolean; drafts: boolean };
}

const LAYERS = { I: "l1", II: "l2", III: "l3" } as const;

export default function SetupFlow(p: Props) {
  const router = useRouter();
  const [step, setStep] = useState<SetupStepKey>(() => resumeAt(p.state));
  // A branded welcome before step 1, shown only on a fresh setup (9 Nov 2026,
  // from the 7 Nov walkthrough). Someone returning mid-setup goes straight to
  // their step.
  const [welcome, setWelcome] = useState(() => stepsSettled(p.state) === 0 && !p.state.answers.role);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idx = SETUP_STEPS.findIndex(s => s.key === step);
  const go = (k: SetupStepKey) => { setErr(null); setStep(k); window.scrollTo({ top: 0 }); };
  const next = () => go(SETUP_STEPS[Math.min(idx + 1, SETUP_STEPS.length - 1)].key);
  const back = () => go(SETUP_STEPS[Math.max(idx - 1, 0)].key);

  // While anything is still being read, keep the lists fresh.
  const reading = p.docs.some(d => d.status === "pending" || d.status === "processing");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [reading, router]);

  /** Run a save; move on when it worked. */
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string; next?: string }>, after: () => void = next) => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? "That did not save. Please try again."); return; }
      if (r.message) setNote(r.message);
      router.refresh();
      after();
    } catch {
      setErr("That did not save. Please check your connection and try again.");
    } finally { setBusy(false); }
  };

  const settled = p.state.steps;

  if (welcome) {
    return (
      <div className="su-page su-welcome-page">
        <div className="su-welcome" role="main">
          <img src="/forgranted-logo.png" alt="For Granted" className="su-welcome-logo" />
          <h1>Welcome to For Granted</h1>
          <p className="su-lede">This is the Inven(s)tory Portal, {p.tenantName}&rsquo;s home for everything that makes you fundable. A few short steps set it up; everything saves as you go.</p>
          <button type="button" className="sb-btn sb-primary" onClick={() => setWelcome(false)}>Begin</button>
          <p className="su-small">About 15 minutes. You can stop at any step and come back.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="su-page">
      <header className="su-top">
        <img src="/forgranted-logo.png" alt="For Granted" className="su-brand-logo" />
        <span className="su-where">Inven(s)tory Portal · Setting up {p.tenantName}</span>
        <span className="spacer" />
        <span className="su-saved">Saved as you go</span>
        <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => signOutAction()}>Save and sign out</button>
      </header>

      <nav className="su-rail" aria-label="Setup steps">
        <ol>
          {SETUP_STEPS.map((s, i) => {
            const st = settled[s.key];
            const reachable = i <= idx || !!st || i <= SETUP_STEPS.findIndex(x => x.key === resumeAt(p.state));
            return (
              <li key={s.key} className={`${s.key === step ? "on" : ""} ${st ?? ""}`}>
                <button type="button" disabled={!reachable} onClick={() => go(s.key)} aria-current={s.key === step ? "step" : undefined}>
                  <span className="su-num" aria-hidden>{st === "done" ? "✓" : i + 1}</span>
                  <span>{s.label}{st === "skipped" && <em> (later)</em>}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="su-main">
        <div className="su-count">Step {idx + 1} of {SETUP_STEPS.length}</div>
        {note && <p className="su-note" role="status">{note}</p>}
        {step === "you" && <YouStep {...p} busy={busy} onSave={v => run(() => saveYouAction(v))} />}
        {step === "eligibility" && <EligibilityStep profile={p.profile} busy={busy} onBack={back}
          onSave={(v, how) => run(() => saveSetupEligibilityAction(v, how))} />}
        {/* key={step} so Layer I's link box, errors and pending list never
            carry over into Layer II (the carryover bug from the 7 Nov
            walkthrough: React reuses the component between the two steps). */}
        {(step === "layer1" || step === "layer2") && <LayerStep key={step} layer={step === "layer1" ? "I" : "II"} docs={p.docs} grocery={p.grocery} busy={busy} onBack={back}
          onSettle={how => run(() => settleStepAction(step, how))} />}
        {step === "layer3" && <Layer3Step state={p.state} orgType={p.orgType} docs={p.docs} grocery={p.grocery} busy={busy} onBack={back}
          onSettle={how => run(() => settleStepAction("layer3", how))} />}
        {step === "funding" && <FundingStep state={p.state} docs={p.docs} busy={busy} onBack={back}
          onSave={(v, how) => run(() => saveFundingSoFarAction(v, how))} />}
        {step === "team" && <TeamStep state={p.state} busy={busy} onBack={back}
          onSave={(v, how) => run(() => saveTeamAction(v, how))} />}
        {step === "next" && <NextStep state={p.state} docs={p.docs} goals={p.goals} tools={p.tools} onBack={back} />}
        {err && <p className="cl-error" role="alert">{err}</p>}
      </main>
    </div>
  );
}

// ---- Shared bits ----

function Foot({ onBack, children }: { onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="su-foot">
      {onBack && <button type="button" className="sb-btn sb-quiet" onClick={onBack}>Back</button>}
      <span className="spacer" />
      {children}
    </div>
  );
}

function LayerKey({ here, grocery }: { here?: "I" | "II" | "III"; grocery?: GroceryItem[] }) {
  const rows: { k: "I" | "II" | "III"; name: string; what: string }[] = [
    { k: "I", name: "Layer I, Public story.", what: "What the world can already see." },
    { k: "II", name: "Layer II, Internal.", what: "Plans, budgets and past applications." },
    { k: "III", name: "Layer III, Living voice.", what: "Why you do the work, in your own words." },
  ];
  return (
    <aside className="su-aside">
      <h4>The three layers</h4>
      {rows.map(r => (
        <div key={r.k} className={`su-layer ${LAYERS[r.k]} ${here === r.k ? "here" : ""}`}>
          <b>{r.name}</b> <span>{r.what}</span>
          {here === r.k && <span className="su-here">You are here</span>}
        </div>
      ))}
      {grocery && grocery.length > 0 && <Grocery items={grocery} />}
    </aside>
  );
}

/**
 * The readiness grocery list (P1, patch 29): what funders ask for, ticking
 * green as uploads are read. Documents are read the moment they arrive and the
 * page refreshes while anything is processing, so this moves during setup.
 * Nothing here is required; it is the shopping list, not a gate.
 */
function Grocery({ items }: { items: GroceryItem[] }) {
  const order = { essential: 0, important: 1, enriching: 2 } as const;
  const sorted = [...items].sort((a, b) => order[a.tier] - order[b.tier] || a.label.localeCompare(b.label));
  const got = items.filter(i => i.state !== "missing").length;
  const mark = (s: GroceryItem["state"]) => s === "covered" ? "✓" : s === "thin" ? "◑" : "○";
  const title = (s: GroceryItem["state"]) => s === "covered" ? "Found in what you have added"
    : s === "thin" ? "Found, but thin so far" : "Not found yet";
  return (
    <div className="su-grocery">
      <h4>What funders ask for <span className="su-grocery-n">{got} of {items.length}</span></h4>
      <p className="su-small">Ticks itself as your documents are read. Nothing here is required to continue; it is the shopping list.</p>
      <ul>
        {sorted.map(i => (
          <li key={i.key} className={`su-g-${i.state}`} title={title(i.state)}>
            <em aria-hidden="true">{mark(i.state)}</em>
            <span>{i.label}</span>
            {i.tier === "essential" && i.state === "missing" && <b className="su-g-tier">essential</b>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- 1. Welcome and you ----

function YouStep({ tenantName, website, fullName, state, busy, onSave }: Props & { busy: boolean; onSave: (v: { website: string; fullName: string; role: string }) => void }) {
  const [site, setSite] = useState(website ?? "");
  const [name, setName] = useState(fullName);
  const [role, setRole] = useState(state.answers.role ?? "");
  return (
    <div className="su-grid">
      <section className="su-card">
        <h1>Welcome. Let&rsquo;s set up {tenantName}.</h1>
        <p className="su-lede">A few short steps give the portal what it needs to find funders and draft with you. Most can be skipped and finished later.</p>
        <h3>Your organization</h3>
        <label htmlFor="su-org">Organization name</label>
        <input id="su-org" value={tenantName} readOnly aria-readonly title="Ask your For Granted team to change the name." />
        <label htmlFor="su-site">Website</label>
        <input id="su-site" value={site} onChange={e => setSite(e.target.value)} placeholder="example.org" inputMode="url" />
        <div className="hint">We read your public pages and add them to your Inven(s)tory as a Layer I document, so it is not empty even if you skip the uploads.</div>
        <h3>You</h3>
        <label htmlFor="su-name">Your name</label>
        <input id="su-name" value={name} onChange={e => setName(e.target.value)} />
        <label htmlFor="su-role">Your role</label>
        <select id="su-role" value={role} onChange={e => setRole(e.target.value)}>
          <option value="">Choose…</option>
          {ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <Foot>
          <button type="button" className="sb-btn sb-primary" disabled={busy} onClick={() => onSave({ website: site, fullName: name, role })}>
            {busy ? (site ? "Reading your website…" : "Saving…") : "Continue to Funding Eligibility"}
          </button>
        </Foot>
      </section>
      <aside className="su-aside">
        <h4>How AI is used here</h4>
        <ul className="su-list">
          <li>It reads only your organization&rsquo;s documents.</li>
          <li>It never shares one client&rsquo;s material with another.</li>
          <li>Every draft is yours to edit and approve. You decide what is sent.</li>
        </ul>
        <p className="su-small">You bring the story; the portal&rsquo;s AI tools help you find funders and draft from it.</p>
        <h4>About 15 minutes</h4>
        <p className="su-small">Stop whenever you like. Everything saves as you go, and you come back to the step you were on.</p>
        <p className="su-small">Only you see these setup steps. Teammates skip them.</p>
      </aside>
    </div>
  );
}

// ---- 2. Funding Eligibility ----

function EligibilityStep({ profile, busy, onBack, onSave }: {
  profile: EligibilityProfile; busy: boolean; onBack: () => void;
  onSave: (v: Partial<EligibilityProfile>, how: "done" | "skipped") => void;
}) {
  // What the form shows is what is saved: registered in the US and looking for grants unless changed.
  const [p, setP] = useState<EligibilityProfile>(() => ({ ...profile, country_code: profile.country_code ?? "US", funding_kinds: profile.funding_kinds?.length ? profile.funding_kinds : ["grants"] }));
  const [more, setMore] = useState(true);
  const set = <K extends keyof EligibilityProfile>(k: K, v: EligibilityProfile[K]) => setP(x => ({ ...x, [k]: v }));
  const kinds = new Set(p.funding_kinds?.length ? p.funding_kinds : ["grants"]);
  const toggleKind = (k: string) => { const n = new Set(kinds); if (n.has(k)) n.delete(k); else n.add(k); set("funding_kinds", [...n]); };
  const ready = !!p.org_type && p.cause_areas.length > 0;
  return (
    <div className="su-grid">
      <section className="su-card">
        <h1>Funding Eligibility <span className="su-sub">Who can fund you?</span></h1>
        <p className="su-lede">This tells the portal which funders could say yes to you. It takes about three minutes.</p>
        <div className={`su-group su-need ${ready ? "ok" : ""}`}>
          <div className="su-group-head">
            <h3>Needed to search</h3>
            <span className="spacer" />
            <span className={`su-badge ${ready ? "ok" : ""}`}>{ready ? "✓ Complete" : "Must have"}</span>
          </div>
          <p className="su-small">Funder Matches cannot search until you give an organization type and at least one cause area. You can still finish them later.</p>
          <label htmlFor="su-otype">Organization type</label>
          <select id="su-otype" value={p.org_type ?? ""} onChange={e => set("org_type", e.target.value || null)}>
            <option value="">Choose…</option>
            {ORG_TYPES.map(o => <option key={o.v} value={o.v}>{o.l.replace(/ — /g, ", ").replace(/ \/ /g, " or ")}</option>)}
          </select>
          <label htmlFor="su-country">Where you are registered</label>
          <select id="su-country" value={p.country_code ?? "US"} onChange={e => set("country_code", e.target.value)}>
            {COUNTRY_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <TagField label="Cause areas" values={p.cause_areas} onChange={v => set("cause_areas", v)} placeholder="e.g. Youth development"
            hint="Add one at a time, or separate several with commas. Each becomes its own tag." />
          <div className="su-label" id="su-kinds-l">What you are looking for</div>
          <div className="su-small">This decides where we search, not what you are eligible for.</div>
          <div className="su-kinds" role="group" aria-labelledby="su-kinds-l">
            {FUNDING_KINDS.map(k => (
              <label key={k.v} className={`su-kind ${kinds.has(k.v) ? "on" : ""}`}>
                <input type="checkbox" checked={kinds.has(k.v)} onChange={() => toggleKind(k.v)} />
                <span><b>{k.l}</b><span>{k.hint}</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="su-group su-opt">
          <div className="su-group-head">
            <h3>Improves your matches</h3>
            <span className="su-badge opt">Nice to have</span>
            <span className="spacer" />
            <button type="button" className="sb-btn sb-quiet sb-sm" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? "Skip these for now" : "Show these"}</button>
          </div>
          <p className="su-small">Optional. Each one sharpens the screening.</p>
          {more && <>
            <label htmlFor="su-budget">Annual budget</label>
            <select id="su-budget" value={p.budget_band ?? ""} onChange={e => set("budget_band", e.target.value || null)}>
              <option value="">Choose…</option>
              {BUDGET_BANDS.map(o => <option key={o.v} value={o.v}>{o.l.replace(/–/g, " to ")}</option>)}
            </select>
            <CountryField label="Other countries you work in" values={p.countries_served ?? []} onChange={v => set("countries_served", v)} exclude={p.country_code ?? "US"} />
            <label htmlFor="su-sam">Federal registration (SAM.gov)</label>
            <select id="su-sam" value={p.federal_registration} onChange={e => set("federal_registration", e.target.value)}>
              {FEDERAL_REG.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <label htmlFor="su-match">Can you match funds?</label>
            <select id="su-match" value={p.match_capacity_pct ?? ""} onChange={e => set("match_capacity_pct", e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Not sure</option>
              {MATCH_CAPACITY.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </>}
        </div>
        <Foot onBack={onBack}>
          <button type="button" className="sb-btn sb-secondary" disabled={busy} onClick={() => onSave(p, "skipped")}>Complete later</button>
          <button type="button" className="sb-btn sb-primary" disabled={busy || !ready}
            title={ready ? undefined : "Add an organization type and a cause area, or choose Complete later."}
            onClick={() => onSave(p, "done")}>{busy ? "Saving…" : "Save and continue"}</button>
        </Foot>
      </section>
      <aside className="su-aside">
        <h4>Why eligibility first</h4>
        <p className="su-small">Every search screens funders against these answers. A wrong organization type is the most common reason a promising funder turns out to be a dead end.</p>
      </aside>
    </div>
  );
}

// ---- 3 and 4. Layer I and Layer II ----

const LAYER_COPY = {
  I: {
    title: "Layer I: your public story",
    lede: "Start with what is already public. These documents give the portal your facts, numbers and track record.",
    box: "Upload your public story", boxSub: "Anything already public about you.",
    examples: ["Annual or impact reports", "Your most recent tax filing (Form 990 or your country's equivalent)", "Press coverage, awards, case studies", "Brochures and one-pagers"],
    cta: "Continue to Layer II",
  },
  II: {
    title: "Layer II: how you work inside",
    lede: "The documents funders never see but always ask about: plans, budgets, and what you have applied for before.",
    box: "Upload your internal documents", boxSub: "Only your team and For Granted see these.",
    examples: ["Strategic plan or theory of change", "This year's budget", "Past grant applications, won or not", "Board minutes and program reports"],
    cta: "Continue to Layer III",
  },
} as const;

function LayerStep({ layer, docs, grocery, busy, onBack, onSettle }: {
  layer: "I" | "II"; docs: SetupDoc[]; grocery?: GroceryItem[]; busy: boolean; onBack: () => void; onSettle: (how: "done" | "skipped") => void;
}) {
  const c = LAYER_COPY[layer];
  const mine = docs.filter(d => d.layer === layer);
  return (
    <div className="su-grid">
      <section className="su-card">
        {/* The explainer between eligibility and the first upload (9 Nov 2026,
            from the 7 Nov walkthrough): nobody has seen an Inven(s)tory
            before, so define it, dictionary-style, before asking for
            documents. Layer I only; links are Layer I only too, since Layer II
            is about the actual documents (same decision). */}
        {layer === "I" && (
          <div className="su-def">
            <div className="su-def-word">In&middot;ven(s)&middot;to&middot;ry <span>noun</span></div>
            <p>An inventory of your story: a complete, running record of who your organization is (public, private, past, present and fundable future). Every document you add here builds one brain, and that brain is what finds your funders and drafts your applications.</p>
            <p className="su-small">Your eligibility profile is done. Now we build the brain.</p>
          </div>
        )}
        <h1>{c.title}</h1>
        <p className="su-lede">{c.lede}</p>
        <div className={`su-layerbox ${LAYERS[layer]}`}>
          <h3>{c.box}</h3>
          <p className="su-small">{c.boxSub}</p>
          <Uploader layer={layer} docs={mine} allowLinks={layer === "I"} />
          <h4>Good examples</h4>
          <ul className="su-list">{c.examples.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
        <Foot onBack={onBack}>
          <button type="button" className="sb-btn sb-secondary" disabled={busy} onClick={() => onSettle("skipped")}>Skip for now</button>
          <button type="button" className="sb-btn sb-primary" disabled={busy || mine.length === 0}
            title={mine.length ? undefined : "Add a document first, or choose Skip for now."}
            onClick={() => onSettle("done")}>{c.cta}</button>
        </Foot>
      </section>
      <LayerKey here={layer} grocery={grocery} />
    </div>
  );
}

interface Pending { key: string; name: string; state: "uploading" | "failed"; error?: string }

/** Files and links into one layer. Reading starts as soon as each arrives. */
function Uploader({ layer, docs, allowLinks, typeTag = "" }: { layer: "I" | "II" | "III"; docs: SetupDoc[]; allowLinks?: boolean; typeTag?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const one = async (file: File) => {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    if (!isAccepted(file.name)) {
      setPending(x => [...x, { key, name: file.name, state: "failed", error: `Not a type the portal reads. Email it to ${SUPPORT_EMAIL} and we will add it.` }]);
      return;
    }
    setPending(x => [...x, { key, name: file.name, state: "uploading" }]);
    try {
      const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const s = await fetch("/api/upload/sign", json({ filename: file.name, size: file.size }));
      const sb = await s.json().catch(() => ({}));
      if (!s.ok) throw new Error(sb.error ?? `Upload failed (${s.status})`);
      const { error: upErr } = await browserClient().storage.from("documents")
        .uploadToSignedUrl(sb.path, sb.token, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(`The file could not be stored: ${upErr.message}`);
      const c = await fetch("/api/upload/complete", json({
        docId: sb.docId, filename: file.name, contentType: file.type, title: file.name.replace(/\.[^.]+$/, ""), layer, tags: "setup", typeTag, outcome: "",
      }));
      const cb = await c.json().catch(() => ({}));
      if (!c.ok) throw new Error(cb.error ?? `Upload failed (${c.status})`);
      setPending(x => x.filter(p => p.key !== key));
      router.refresh();
    } catch (e) {
      setPending(x => x.map(p => p.key === key ? { ...p, state: "failed", error: e instanceof Error ? e.message : "Upload failed." } : p));
    }
  };
  const many = (files: FileList | null) => { if (files) for (const f of Array.from(files)) void one(f); };

  const addLink = async () => {
    if (layer === "III" || !link.trim()) return;
    setLinkBusy(true); setLinkErr(null);
    try {
      const r = await addSetupLinkAction(link, layer);
      if (!r.ok) setLinkErr(r.error); else { setLink(""); router.refresh(); }
    } catch { setLinkErr("That link could not be added. Please try again."); }
    finally { setLinkBusy(false); }
  };

  const label = (s: string) => s === "ready" ? "Read" : s === "failed" ? "Needs attention" : s === "processing" ? "Reading" : "Waiting";

  return (
    <div className="su-upload">
      <div className={`su-drop ${over ? "over" : ""}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); many(e.dataTransfer.files); }}>
        <b>Drag files here</b>
        <span className="su-small">{ACCEPTED_LABEL}. Up to 25 MB each.</span>
        <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => input.current?.click()}>Choose files</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT_ATTR} onChange={e => { many(e.target.files); e.target.value = ""; }} />
      </div>
      {allowLinks && layer !== "III" && (
        <div className="su-link">
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="Or paste a web link, e.g. a press article"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addLink(); } }} />
          <button type="button" className="sb-btn sb-secondary sb-sm" disabled={linkBusy || !link.trim()} onClick={addLink}>{linkBusy ? "Reading…" : "Add link"}</button>
        </div>
      )}
      {linkErr && <p className="cl-error">{linkErr}</p>}
      {(pending.length > 0 || docs.length > 0) && (
        <div className="su-files">
          <h4>Being read now</h4>
          <p className="su-small">We start reading as soon as a file arrives. Carry on; nothing waits for this.</p>
          <ul>
            {pending.map(f => <li key={f.key} className={f.state}><span>{f.name}</span><em>{f.state === "uploading" ? "Uploading" : f.error}</em></li>)}
            {docs.map(d => <li key={d.id} className={d.status}><span>{d.title}</span><em>{label(d.status)}</em></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- 5. Layer III ----

function Layer3Step({ state, orgType, docs, grocery, busy, onBack, onSettle }: {
  state: SetupState; orgType: TenantOrgType; docs: SetupDoc[]; grocery?: GroceryItem[]; busy: boolean; onBack: () => void; onSettle: (how: "done" | "skipped") => void;
}) {
  const router = useRouter();
  const [read, setRead] = useState(!!state.layer3ReadAt);
  const [how, setHow] = useState<"record" | "write" | "talk" | null>(null);
  const [msg, setMsg] = useState<string | null>(state.answers.interview_requested_at ? "You asked for an interview. Your For Granted team will email you to find a time." : null);
  const mine = docs.filter(d => d.layer === "III");

  const toggleRead = async (v: boolean) => {
    setRead(v);
    const r = await markLayer3ReadAction(v).catch(() => ({ ok: false as const, error: "That did not save." }));
    if (!r.ok) { setRead(!v); setMsg(r.error); } else router.refresh();
  };
  const ask = async () => {
    const r = await requestInterviewAction().catch(() => ({ ok: false as const, error: "That did not save. Please try again." }));
    setMsg(r.ok ? (r.message ?? null) : r.error);
  };
  const canGo = canSettle("layer3", "skipped", { layer3ReadAt: read ? "read" : null });

  return (
    <div className="su-grid">
      <section className="su-card">
        <h1>Layer III: your living voice</h1>
        <p className="su-lede">The shortest step here, and the one funders remember. Please read this part; the recording can wait.</p>
        <div className="su-layerbox l3">
          <h3>Why your voice matters most</h3>
          <p>Funders read hundreds of applications that say the right things. What they remember is the person behind the work: why you started, who you do it for, what keeps you going. That is your living voice, and it is the one thing no document already holds.</p>
          <p>Your Layer I and Layer II documents give the portal facts. Layer III gives it meaning. With it, Story Cards carry your real reasons, drafts sound like you rather than like a template, and the portal can tell a reviewer why this work matters, not just what it is.</p>
          <label className="su-check">
            <input type="checkbox" checked={read} onChange={e => void toggleRead(e.target.checked)} />
            <span><b>I have read this</b> <span className="su-small">Required. The recording itself can be skipped.</span></span>
          </label>
        </div>
        <h3>Share your voice, any way that suits you</h3>
        <div className="su-ways">
          <button type="button" className={`su-way ${how === "record" ? "on" : ""}`} onClick={() => setHow("record")}>
            <b>Upload a recording or transcript</b><span>Answer the questions out loud, then upload what you have. Fifteen minutes is plenty.</span>
          </button>
          <button type="button" className={`su-way ${how === "write" ? "on" : ""}`} onClick={() => setHow("write")}>
            <b>Answer in writing</b><span>The same questions, typed. Short answers are fine.</span>
          </button>
          <button type="button" className={`su-way ${how === "talk" ? "on" : ""}`} onClick={() => setHow("talk")}>
            <b>Talk it through with For Granted</b><span>Ask for a 30-minute interview and we record it for you.</span>
          </button>
        </div>
        {how === "record" && <>
          <p className="su-small">The portal cannot turn a recording into text yet. If you have a transcript (most phone and meeting apps make one), upload that. Otherwise email the recording to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and your For Granted team will add it.</p>
          <Uploader layer="III" docs={mine} />
        </>}
        {how === "write" && <LivingVoicePrompts orgType={orgType} onSaved={() => router.refresh()} />}
        {how === "talk" && (
          <div className="su-talk">
            {state.answers.interview_requested_at
              ? <p className="su-small">Asked. Your For Granted team will email you to find a time.</p>
              : <button type="button" className="sb-btn sb-secondary" onClick={ask}>Ask for an interview</button>}
          </div>
        )}
        {msg && <p className="su-note" role="status">{msg}</p>}
        {!canGo && <p className="su-small su-gate">Tick &ldquo;I have read this&rdquo; to carry on.</p>}
        <Foot onBack={onBack}>
          <button type="button" className="sb-btn sb-secondary" disabled={busy || !canGo} title="You can add your voice later from Getting started." onClick={() => onSettle("skipped")}>Skip for now</button>
          <button type="button" className="sb-btn sb-primary" disabled={busy || !canGo || mine.length === 0}
            title={mine.length ? undefined : "Add your voice first, or skip for now."}
            onClick={() => onSettle("done")}>Continue</button>
        </Foot>
      </section>
      <LayerKey here="III" grocery={grocery} />
    </div>
  );
}

// ---- 6. Funding so far ----

function FundingStep({ state, docs, busy, onBack, onSave }: {
  state: SetupState; docs: SetupDoc[]; busy: boolean; onBack: () => void;
  onSave: (v: { known_funders: KnownFunder[]; deadlines: Deadline[] }, how: "done" | "skipped") => void;
}) {
  const [funders, setFunders] = useState<KnownFunder[]>(state.answers.known_funders?.length ? state.answers.known_funders : [{ name: "", relationship: "funded" }]);
  const [dates, setDates] = useState<Deadline[]>(state.answers.deadlines?.length ? state.answers.deadlines : [{ what: "", date: null }]);
  // Funder-name type-ahead against Ground Truth (P1, patch 29): suggestions
  // for the name being typed, debounced, so what gets stored matches the
  // record the portal screens against. Typing anything else still works; a
  // lookup failure just means no suggestions.
  const [suggestions, setSuggestions] = useState<{ name: string; location: string | null }[]>([]);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupSeq = useRef(0);
  const lookup = (text: string) => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const q = text.trim();
    if (q.length < 3) { setSuggestions([]); return; }
    lookupTimer.current = setTimeout(async () => {
      const seq = ++lookupSeq.current;
      const r = await suggestFundersAction(q).catch(() => []);
      if (seq === lookupSeq.current) setSuggestions(r);
    }, 600);
  };
  const funderForms = docs.filter(d => d.typeTag === "funder_form");
  return (
    <div className="su-grid su-single">
      <section className="su-card">
        <h1>Your funding so far</h1>
        <p className="su-lede">Optional, and quick. Two lists that save time later.</p>
        <h3>Funders you already know</h3>
        <p className="su-small">So the portal never presents an old relationship as a new discovery, and your team knows the history.</p>
        <div className="su-rows">
          <div className="su-row su-row-head"><span>Funder</span><span>Relationship</span><span /></div>
          {funders.map((f, i) => (
            <div key={i} className="su-row">
              <input aria-label="Funder" value={f.name} list="su-funder-suggest"
                onChange={e => { const v = e.target.value; setFunders(fs => fs.map((x, j) => j === i ? { ...x, name: v } : x)); lookup(v); }} />
              <select aria-label="Relationship" value={f.relationship} onChange={e => setFunders(fs => fs.map((x, j) => j === i ? { ...x, relationship: e.target.value as KnownFunder["relationship"] } : x))}>
                {RELATIONSHIPS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
              <button type="button" className="sb-btn sb-quiet sb-sm" aria-label={`Remove ${f.name || "this funder"}`} onClick={() => setFunders(fs => fs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setFunders(fs => [...fs, { name: "", relationship: "known" }])}>+ Add a funder</button>
        <h3>Deadlines you are working toward</h3>
        <p className="su-small">Applications already on your list. Your For Granted team sees where the urgency is.</p>
        <div className="su-rows">
          <div className="su-row su-row-head"><span>What it is</span><span>Deadline</span><span /></div>
          {dates.map((d, i) => (
            <div key={i} className="su-row">
              <input aria-label="What it is" value={d.what} onChange={e => setDates(ds => ds.map((x, j) => j === i ? { ...x, what: e.target.value } : x))} />
              <input aria-label="Deadline" type="date" value={d.date ?? ""} onChange={e => setDates(ds => ds.map((x, j) => j === i ? { ...x, date: e.target.value || null } : x))} />
              <button type="button" className="sb-btn sb-quiet sb-sm" aria-label="Remove this deadline" onClick={() => setDates(ds => ds.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
        <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setDates(ds => [...ds, { what: "", date: null }])}>+ Add a deadline</button>
        <datalist id="su-funder-suggest">
          {suggestions.map(sg => <option key={sg.name} value={sg.name}>{sg.location ?? undefined}</option>)}
        </datalist>
        <h3>Have a funder&rsquo;s application in hand?</h3>
        <p className="su-small">Upload the application form, questions or guidelines for anything you are working toward. Your For Granted team sees exactly what the funder asks, and the portal files it as the funder&rsquo;s material, never as your story.</p>
        <Uploader layer="II" docs={funderForms} typeTag="funder_form" />
        <Foot onBack={onBack}>
          <button type="button" className="sb-btn sb-secondary" disabled={busy} onClick={() => onSave({ known_funders: funders, deadlines: dates }, "skipped")}>Skip</button>
          <button type="button" className="sb-btn sb-primary" disabled={busy} onClick={() => onSave({ known_funders: funders, deadlines: dates }, "done")}>{busy ? "Saving…" : "Save and continue"}</button>
        </Foot>
      </section>
    </div>
  );
}

// ---- 7. Team ----

function TeamStep({ state, busy, onBack, onSave }: {
  state: SetupState; busy: boolean; onBack: () => void; onSave: (v: { invites: { email: string }[] }, how: "done" | "skipped") => void;
}) {
  const asked = state.answers.invites ?? [];
  const [emails, setEmails] = useState<string[]>([""]);
  const filled = emails.filter(e => e.trim());
  return (
    <div className="su-grid">
      <section className="su-card">
        <h1>Who else works on funding?</h1>
        <p className="su-lede">Grant work is rarely one person&rsquo;s job. Bring in whoever writes, reviews or approves.</p>
        <h3>Add your team</h3>
        <p className="su-small">Optional. Your For Granted team sets up each login and emails it to the person.</p>
        {asked.length > 0 && <ul className="su-list">{asked.map(a => <li key={a.email}>{a.email}: {a.created ? "login made" : "asked for"}</li>)}</ul>}
        <div className="su-rows">
          {emails.map((e, i) => (
            <div key={i} className="su-row su-row-2">
              <input aria-label="Email" type="email" placeholder="name@example.org" value={e} onChange={ev => setEmails(es => es.map((x, j) => j === i ? ev.target.value : x))} />
              <button type="button" className="sb-btn sb-quiet sb-sm" aria-label={`Remove ${e || "this person"}`} onClick={() => setEmails(es => es.length > 1 ? es.filter((_, j) => j !== i) : [""])}>×</button>
            </div>
          ))}
        </div>
        <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setEmails(es => [...es, ""])}>+ Add another person</button>
        <Foot onBack={onBack}>
          <button type="button" className="sb-btn sb-secondary" disabled={busy} onClick={() => onSave({ invites: [] }, "skipped")}>Skip</button>
          <button type="button" className="sb-btn sb-primary" disabled={busy} onClick={() => onSave({ invites: filled.map(email => ({ email })) }, filled.length ? "done" : "skipped")}>
            {busy ? "Saving…" : filled.length ? "Send to For Granted and continue" : "Continue"}
          </button>
        </Foot>
      </section>
      <aside className="su-aside">
        <h4>What teammates see</h4>
        <ul className="su-list">
          <li>They skip these setup steps.</li>
          <li>Each gets a short tour the first time they open a tool.</li>
          <li>They see the same Inven(s)tory you do.</li>
        </ul>
      </aside>
    </div>
  );
}

// ---- 8. What happens next ----

const STEP_TODO: Partial<Record<SetupStepKey, string>> = {
  eligibility: "Finish Funding Eligibility",
  layer1: "Add a Layer I document",
  layer2: "Add a Layer II document",
  layer3: "Add your living voice (Layer III)",
  funding: "List the funders you already know",
  team: "Add your team",
};

function NextStep({ state, docs, goals, tools, onBack }: { state: SetupState; docs: SetupDoc[]; goals: Goal[]; tools: Props["tools"]; onBack: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = GOALS.filter(x => goals.includes(x.v));
  const [goal, setGoal] = useState<Goal>(() => { const g = state.answers.goal as Goal | null | undefined; return g && goals.includes(g) ? g : (shown[0]?.v ?? "organize"); });
  const total = docs.length;
  const read = docs.filter(d => d.status === "ready").length;
  const todo = useMemo(() => Object.entries(state.steps).filter(([, v]) => v === "skipped").map(([k]) => STEP_TODO[k as SetupStepKey]).filter(Boolean) as string[], [state.steps]);
  const g = GOALS.find(x => x.v === goal) ?? GOALS[2];

  // The completion moment (P1, patch 29): finishing earns a beat of
  // congratulation before the portal, not an abrupt page change.
  const [done, setDone] = useState<string | null>(null);
  const finish = async () => {
    setBusy(true); setErr(null);
    const r = await finishSetupAction(goal).catch(() => null);
    if (r && r.ok) { setBusy(false); setDone(r.next ?? "/invenstory"); window.scrollTo({ top: 0 }); return; }
    setBusy(false);
    setErr(r && !r.ok ? r.error : "That did not save. Please check your connection and try again.");
  };

  if (done) {
    return (
      <div className="su-grid su-single">
        <section className="su-card su-done" role="status">
          <div className="su-done-mark" aria-hidden="true">&#10003;</div>
          <h1>That&rsquo;s it. Your Inven(s)tory is live.</h1>
          <p className="su-lede">Everything you added is being read and woven into one brain: your facts, your numbers, your voice. From here, every search and every draft starts from a place of preparation instead of a blank page.</p>
          <ul className="su-list">
            {total > 0 && <li>{read === total ? `All ${total} document${total === 1 ? "" : "s"} read.` : `${read} of ${total} documents read so far; the rest finish on their own.`}</li>}
            <li>Your readiness is being assessed now, so your first look at the Inven(s)tory shows a scored checklist.</li>
            {todo.length > 0 && <li>The steps you skipped wait under Getting started; nothing is lost.</li>}
          </ul>
          <div className="su-foot">
            <button type="button" className="sb-btn sb-primary" onClick={() => { router.push(done); router.refresh(); }}>
              {g.v === "funders" ? "Open Funding" : g.v === "draft" ? "Open your applications" : "Open your Inven(s)tory"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="su-grid">
      <section className="su-card">
        <h1>You are set up. Here is what happens next.</h1>
        <p className="su-lede">The portal is reading what you gave it. Choose where to start, and we will take you there.</p>
        {total > 0 && (
          <div className="su-progress">
            <b>Reading your documents</b>
            <span>{read} of {total} read</span>
            <div className="su-bar"><i style={{ width: `${Math.round((read / total) * 100)}%` }} /></div>
            <span className="su-small">You can leave this page; reading keeps going.</span>
          </div>
        )}
        <h3>What do you want help with first?</h3>
        <div className="su-ways">
          {shown.map(x => (
            <button key={x.v} type="button" className={`su-way ${goal === x.v ? "on" : ""}`} aria-pressed={goal === x.v} onClick={() => setGoal(x.v)}>
              <b>{x.title}</b><span>{x.desc}</span><em>{x.where}</em>
            </button>
          ))}
        </div>
        <Foot onBack={onBack}>
          <button type="button" className="sb-btn sb-primary" disabled={busy} onClick={finish}>
            {busy ? "Opening…" : g.v === "funders" ? "Go to Funder Matches" : g.v === "draft" ? "Go to your applications" : "Go to your Inven(s)tory"}
          </button>
        </Foot>
        {err && <p className="cl-error" role="alert">{err}</p>}
      </section>
      <aside className="su-aside">
        <h4>Your tools</h4>
        <ul className="su-tools">
          <li><b>The Inven(s)tory</b><span>Everything that makes you fundable, in three layers and Story Cards.</span></li>
          {tools.chat && <li><b>Chat</b><span>Ask anything about your organization, or how the portal works.</span></li>}
          {tools.funder_matches && <li><b>Funding</b><span>Grants you can apply to and funders worth approaching, screened against your eligibility, with a fit report.</span></li>}
          {tools.drafts && <li><b>Drafts</b><span>The applications your For Granted team is preparing with you.</span></li>}
        </ul>
        {todo.length > 0 && <>
          <h4>Still to do</h4>
          <p className="su-small">These wait for you in Getting started on your Inven(s)tory.</p>
          <ul className="su-list">{todo.map(t => <li key={t}>{t}</li>)}</ul>
        </>}
      </aside>
    </div>
  );
}
