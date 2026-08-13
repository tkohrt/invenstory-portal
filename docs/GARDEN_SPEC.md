# The Inven(s)tory Garden — Design & Build Spec

Approved by Shane 2026-08-13 (spec + all slices; plant visible by default; emails
built but disabled pending review; client-picked species with Golden Pothos default).

The Garden gives each client's Inven(s)tory a living visual identity — a plant whose
size reflects the *permanent growth* of their story and whose health reflects its
*freshness*. It exists to drive one behavior: uploading documents that make the
Inven(s)tory more robust. Design constraints from Shane: small and unobtrusive,
simple flat art that matches the clean UI, engaging prompts that refresh on every
login/upload and open the upload drawer in one click, never punishing.

---

## 1. The Inven(s)tory Health Score (single source of truth)

Computed server-side per tenant on library load. Two independent axes:

**GROWTH (size — never decreases, matches the compounding thesis):**
`growth_points = docs + words/2000 + 2×layers_covered + achievements_unlocked`
- **Size 1 (Seedling):** < 10 points
- **Size 2 (Established):** 10–24 points
- **Size 3 (Flourishing):** ≥ 25 points

**FRESHNESS (health — fully recoverable, gently capped):**
Days since most recent document upload (any layer):
- **Thriving:** ≤ 45 days
- **Okay:** 46–90 days (slight droop)
- **Thirsty:** > 90 days (droop + one yellowing leaf — the floor; never dead)

Layer III staleness accelerant: if no Layer III doc in 180 days, health drops one
band (interviews/updates are the "living voice" and must stay living).

Score (0–100) for meters/emails: coverage 30 (10/layer) + volume 25 (min(25, docs×2))
+ freshness 30 (thriving 30 / okay 20 / thirsty 8) + answers 15 (% of Answer Library
answered; redistributed to volume if AL hidden). Fairness rule: normalized by
coverage + freshness, not raw counts — a small, complete, current Inven(s)tory
outranks a big stale one.

## 2. Plant visuals (parameterized SVG — no image assets)

One `PlantVisual` component; species/size/health/skin are props. Flat, minimal,
2-tone-green style consistent with the UI. ~120px tall at top-center of the
Inven(s)tory page (max-height capped so it never dominates).

- **Golden Pothos** (default): heart leaves on trailing vines.
- **Monstera:** large split leaves (splits appear at size 2+).
- **Spider Plant:** arching blades; pups on stolons at size 3.

Health rendering: `okay` = 6° droop transform; `thirsty` = 12° droop + one leaf
hue-shifted yellow. Never brown/dead.

**Size-3 thriving flourish:** species-specific tendrils extend down the page
background behind the three layer sections — pothos vines / monstera air roots /
spider-plant stolons with pups. Fixed low opacity (≈12%), pointer-events none,
behind cards, hidden on mobile.

Species chosen by client via one-time picker card (Pothos shown until chosen);
changeable later in Account. `hidden` flag lets a client hide the plant entirely;
admins can toggle per client too.

## 3. Prompt engine ("Water your Inven(s)tory")

A single compact banner beside the plant. Server computes the top gap, picks copy
from a rotation pool seeded by (date, doc count) so it changes every login and
after every upload. Clicking opens the upload drawer (prefilling the target layer).
Priority order: missing layer > stale (>60d) > Layer III cadence (>90d) > near
milestone > generic growth. Copy bank ~4 variants per case, e.g.:
- "Water your Inven(s)tory — upload your Q3 investor update to Layer II."
- "Your Monstera is ready for a new leaf: add one more Layer II doc to reach a growth milestone."
- "Grow your roots — contribute a meeting transcript or a quarterly self-interview to Layer III."
- "Two documents from your next milestone. Keep cultivating."

## 4. Milestones & unlocks

Achievements (persisted, celebrated once, never revoked): first_doc, docs_5,
docs_10, docs_20, docs_50, all_layers, first_interview (first L3), size_2, size_3,
age_6mo, age_1yr, answers_reviewed_5, grant_submitted, grant_won.

Unlock catalog (cosmetics only — no feature gating):
- **Pots** (default terracotta): glazed (docs_5), mosaic (docs_10), Talavera
  (docs_20), blue-and-white porcelain (docs_50), jade (age_1yr), raku (grant_won).
- **Trinkets:** For Granted pot flag (all_layers), garden gnome (age_6mo), mushroom
  (docs_10), crane statue (docs_20), gold "Funded" flag (grant_won).
- **Variegation:** variegated leaves (answers_reviewed_5), golden hue (grant_won).

**Bloom:** grant submitted = bud appears for 14 days; grant won = flowers, 30 days.
The plant records real wins, not just uploads.

## 5. Admin greenhouse

All clients page: each client row shows a small plant thumbnail (species, size,
health at a glance) — the portfolio becomes a shelf of plants; a thirsty plant is
an outreach cue.

## 6. Emails (built now, DISABLED behind GROWTH_EMAILS_ENABLED)

Via existing Resend pipeline. All sending gated; test route sends samples only to
info@forgranted.com until Shane flips the flag.
- **Monthly Growth Report:** plant snapshot (inline SVG→PNG or styled HTML), what
  changed (docs/words/answers), one next action deep-linking to upload.
- **Milestone email:** on unlock ("You unlocked the Talavera pot 🪴").
- **Thirsty nudge:** single gentle email at 60 days quiet, max once/quarter.
- **Bloom email:** grant submitted/won celebration.
Cadence cap: monthly digest + event triggers; per-client opt-out stored on tenant.

## 7. Data model

```sql
plant_state(tenant_id pk→tenant, species text null, pot text default 'terracotta',
  trinket text null, variegation text null, hidden bool default false,
  planted_at timestamptz default now(), updated_at timestamptz)
achievement(tenant_id→tenant, key text, unlocked_at timestamptz,
  unique(tenant_id, key))
```
RLS: tenant-scoped read; writes via server actions (client may set species/skins/
hidden for own tenant; admin any). Score/size/health computed, never stored
(except achievements), so logic changes apply retroactively.

## 8. Slices

1. Data model + garden engine (score, size, health, milestones, prompts). ✅ = shippable silently
2. PlantVisual SVG + Inven(s)tory header integration + picker + prompt banner + size-3 tendrils. ← first visible ship
3. Achievements strip + skins/pots picker + unlock celebration.
4. Admin greenhouse thumbnails.
5. Emails (flag-dark) + test sends to info@forgranted.com.

Concerns designed around: no shame floor (thirsty ≠ dead), fairness normalization,
collapsible/hideable, SVG-only assets, tendrils at 12% opacity behind content,
no streaks, cosmetics-only unlocks.
