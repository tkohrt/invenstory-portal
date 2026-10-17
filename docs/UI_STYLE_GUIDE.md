# Inven(s)tory Portal: UI Style Guide

Started 17 October 2026, from the code as it stands and the Storyboard cleanup.

## How to use this guide

**This is a starting point, not the truth.** Start any change to the portal's interface here, then judge the change on its own merits. If the change works better by breaking a rule, break it, say so, and update this guide so the next change starts from the better answer.

- **When this guide and the code disagree, the code is what users see.** Say which is right, then fix the other.
- **Every rule here was a decision someone made.** The decision log at the end says who and when. Add to it, and don't silently rewrite it.
- **Status labels.** Each section is marked as one of:
  - **Settled**: used across the portal.
  - **Direction**: adopted on newer pages; older pages move to it when they are next touched.
  - **Open**: a known inconsistency nobody has decided yet.

## 1. Principles (Settled)

1. **One thing matters most on each screen. Make it the biggest thing on it.** On the Storyboard that is the question being answered, not the toolbar.
2. **Rank every action.** At most one primary action per area. Everything else is secondary or quiet. If two buttons look equally important, one of them is wrong.
3. **Account for everything, hide nothing silently.** If the portal leaves something out (a form field, a filtered card, a skipped question), it says so and says where it went. A person who counts 31 items must be able to find all 31.
4. **Say why, not just "loading".** A wait says what is happening and roughly how long it will take: "Reading 9 documents, about 30 seconds". Use `Busy` for seconds; use `JobProgress` for anything that can outlive a page.
5. **The page never scrolls as a whole.** The sidebar and the main area each scroll on their own. Working pages such as the Storyboard size themselves to the window. Anything opened from a bottom bar opens upward.
6. **Plain words over system words.** "Questions to write", "form facts", "Saved". Never "parse", "section", "tenant", "item kind" or "chunk".
7. **AI is a tool the person uses, and it looks like one.** Every action that calls a model is marked the same way (section 4), and the copy describes what the person gets, not what the model does.

## 2. Colour

### Tokens (Settled, in `:root` in `app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f6f7f9` | Page background |
| `--panel` | `#ffffff` | Cards, panels, bars |
| `--ink` | `#1f2430` | Text; the selected tab and the current question pill |
| `--muted` | `#6b7280` | Secondary text, labels, counts |
| `--line` | `#e6e8ec` | Borders and dividers |
| `--accent` | `#9a7b2f` | Brand gold: links on older pages, the logo |
| `--accent-soft` | `#f3ecd9` | Gold tint: focus rings on inputs, soft highlights |
| `--l1` / `--l2` / `--l3` | `#c9970c` / `#7c3aed` / `#3fae68` | Inven(s)tory layers: I Public story (gold), II Internal (purple), III Living voice (green) |

Border colour for controls is `#d5d8de`, a step darker than `--line`, so a button reads as a button.

### Meaning colours (Settled; not yet tokens, see Open items)

| Meaning | Background | Border | Text | Examples |
|---|---|---|---|---|
| Primary / done / good | `#e6f2ea` or `#eef5ef` | `#b9d8c4` / `#cfe2d3` | `#1f4d2e` | Primary buttons (filled `#1f4d2e`), "Every answer is done", Verified |
| Needs attention | `#fff6dc` or `#fbf8ef` | `#eadfc2` | `#7a6320` / `#8a6514` | Needs review (dot `#d4a017`), soft warnings, notes |
| Error / blocking | `#fbeceb` | `#e6c2bd` | `#8a2f22` | `ap-error`, `ws-warn`, numbers without a source |
| AI | `#f6f2fb` (hover `#f8f4fd`) | `#c9b6e4` | `#4b2f73` (icon `#6b46a8`) | Every AI action |

### Rules

- **Forest green `#1f4d2e` is the colour of "do this next"** (Settled): primary buttons and done states.
- **Gold is the brand, not a button colour** (Direction, since 17 Oct 2026). Newer pages use it for the layer I mark and occasional links only. Older pages still use gold ghost buttons and gold links; move them over when you next touch them.
- **Purple means AI, except as the layer II mark** (Direction). Keep the two apart: AI is an outline with a spark; layer II is a small dot.
- **Never carry meaning by colour alone** (Settled). A status is a dot plus a word ("● Needs review"), and a layer is a dot plus its name where there is room.

## 3. Type

| Role | Font | Size and weight | Where |
|---|---|---|---|
| Page title | Cormorant Garamond (`--font-heading`) | 24 to 25px, 700 | `page-head h2`, `ws-title` |
| The thing being worked on | Cormorant Garamond | 25px, 700; 21px under 860px | The Storyboard question (`ws-prompt`) |
| Section heading | Cormorant Garamond (h3) or system sans | 15 to 17px, 700 | Panel heads, dialogs |
| Small label | system sans | 12px, 700, uppercase, letter-spacing .06em, `--muted` | "QUESTION 1 OF 13", "YOUR ANSWER" |
| Body | system sans (`-apple-system, Segoe UI, ...`) | 14px / 1.5 | Everything else |
| Meta and counts | system sans | 13px, `--muted` | Funder line, "0 of 13 done" |
| Small print | system sans | 12px, `--muted` | Sources, hints under menu items |

- **Headings are serif and everything else is sans** (Settled). Don't use the serif for UI controls.
- **Keep text 12px or larger** (Settled), and never use `--muted` for text that must be read to act.

## 4. Buttons (Direction; the `sb-` system, `app/globals.css`)

| Class | Looks | Use |
|---|---|---|
| `sb-btn sb-primary` | Filled forest green, white, 700 | The one next step in an area: "Mark this answer done", "Mark completed" |
| `sb-btn sb-secondary` | White, `#d5d8de` outline | Normal actions: "Grant context", "Undo", "+ Your text", "Add" |
| `sb-btn sb-quiet` | No border | Navigation, menus, rare tools: arrows, "More" |
| `sb-btn sb-ai` + `SPARK` icon | White, purple outline, purple text | Anything that calls a model: "✦ Auto-draft all questions" |
| `sb-icon` | Square | Icon-only buttons; always with an `aria-label` |
| `sb-sm` | 30px tall | Inside cards and lists |

- **Sizes.** 36px tall by default; 30px (`sb-sm`) inside cards. Radius 9px.
- **One primary per area.** The header, a toolbar, a card and a dialog are each an area.
- **Name the outcome.** Use a verb and its object: "Mark this answer done", not "Done" or "Submit".
- **Disable with a reason.** A disabled button carries a `title` saying why ("Tidy needs at least three pieces").
- **Legacy (Open):** `btn`, `btn secondary`, `btn ghost`, `btn inline ap-go` and `ap-mini` are still used in about 45 components. Don't mix the two systems in one area. When you touch an area, move it to `sb-`.

## 5. Components

- **Menus** (Direction): `components/MenuButton.tsx` (`MenuButton`, `MenuItem`, `DOTS`).
  - Use them for actions people need occasionally. Each item gets a title plus a one-line hint.
  - A menu closes on Escape, on a click outside and after a choice, and gives focus back to its button. The arrow keys move between items.
  - Pass `up` for a menu opened from a bottom bar.
- **Tags and pills** (Settled):
  - `status-pill` is a draft's status (Drafting, Completed, Submitted, Won, Lost), one per page header.
  - `ov-tag` (with its variants) is a small state label in lists.
  - The `Admin` badge marks pages clients cannot see.
- **Notices** (Settled):
  - `ws-notice` (green) gives information.
  - `ov-note` / `ws-soft-notice` (cream) is a gentle prompt.
  - `ap-error` (red) is for something that failed or blocks the person.
  - `ws-flag-note` (gold, with a flag icon and a heavier left edge) is a **flag**: something about this client that needs attention but blocks nothing, such as "No approved Standard Answers yet".
  - A notice that is not an error can be dismissed (`ws-notice-x` with `bn-x`). A tip shown on every page should be dismissed once and remembered, as the Standard Answers note is.
- **Explanations** (Settled):
  - Put an explanation behind an ⓘ (`components/InfoTip.tsx`) rather than as a paragraph on the page.
  - Its box is hidden with `display:none`, never `visibility:hidden`, which takes up room and caused a page scroll.
  - Use `side="up"` near the bottom of the window.
- **Dialogs and drawers** (Settled):
  - `ws-modal-back` + `ws-modal` asks a question. `ws-versions gc-drawer` is a side panel for reading or managing something.
  - Both carry `aria-modal`, close on Escape and pause the page's keyboard shortcuts.
- **Back** (Settled): one portal-wide Back button in the top bar (`components/BackButton.tsx`). Don't add page-level "← Back" buttons.
- **Empty states** (Settled): say what to do next, with the button or link that does it ("Drag Story Cards here, or press Add on one").
- **Layer marks** (Settled): a Story Card wears its layer as a 2px border in the layer's colour (`ws-card` or `ws-block` with `l1`, `l2` or `l3`), wherever it appears as a card: the Story Cards panel, the answer, the Card Library. Its verification shows as a pill (`cl-badge-ok` Verified, `ws-badge-review` Needs review). In Weave the same colour becomes a pale wash behind the prose. An 8px dot (`ws-ldot`) is for places that are not cards, such as filters.

- **Highlights in text** (Direction, from the Document Reader, 17 Oct 2026): a passage a Story Card came from is a pale wash in its layer's colour with a 2px underline (the Weave look); the current one a deeper wash with a 2px outline; two cards on one passage a double underline; a retired card's passage grey with a dashed underline. Search matches are yellow (`#ffeaa6`), the current one deeper with an outline. Highlights are real links, so they take focus. A marker strip beside a long text shows where each one sits (`.rd-strip`).
- **Toggle chips** (Direction): a pill button with `aria-pressed`, filled `--ink` when on (`.rd-chip`, `.rd-opt`). A chip that reports something waiting has a dashed gold border ("2 couldn't be placed").
- **Switches** (Direction): `role="switch"` buttons, forest green when on (`.rs-switch`), for settings that save at once.
- **Bottom sheet on phones** (Direction): a side panel that shows one selected thing becomes a sheet over the lower part of the screen under 860px, and whatever it describes is scrolled near the top, not the middle, so the sheet never covers it.

## 6. Layout (Settled)

- **The shell.**
  - The sidebar is 240px wide and the top bar 58px; the main area has 24px by 28px padding.
  - On wide screens the ☰ button folds the sidebar to a rail of icons (`nav-collapsed`).
- **Panels.** White on `--bg`, a 1px `--line` border, radius 12px (`--radius`), and `--shadow` only for things that float above the page (menus, dialogs, the action bar).
- **Spacing.** Use a gap of 6, 8, 10, 12, 16 or 20px between items, and 12 to 22px of padding inside panels.
- **Breakpoints.**
  - **Under 860px:** the Story Cards panel becomes a drawer and working pages stop sizing to the window.
  - **Under 640px:** grids and form rows collapse to one column.
  - **At 390px:** nothing may scroll sideways.
- **Working pages** such as the Storyboard put their header and toolbar above a split whose height is fitted to the window, so the two columns scroll on their own. Check any change at 1024×768, 1366×768, 1440×900 and phone width.

## 7. Words (Settled)

- **Write sentences, not system labels.** "Every answer is done. Mark the application completed to save a version and run the final checks."
- **Speak to the person who is there.** Clients see shares and sentences, never dollar amounts for AI use.
- **Use For Granted's names for things:** Inven(s)tory, Story Cards, Standard Answers, Grant context, Weave, Polish, the three layers.
- **Use sentence case for buttons and headings.** Small labels are uppercase in CSS only.
- **No em dashes in interface copy.** Use commas, full stops, parentheses or a colon.
- **Number questions the way the funder does** ("Form item 23"), and write numbers with separators (1,200 characters).

## 8. Accessibility (Settled)

- Use real `<button>`, `<a href>` and `<label>` elements, never a clickable `<div>`.
- Every icon-only control has an `aria-label`.
- Focus is always visible (`outline: 2px solid #1f4d2e`). Closing a menu or dialog returns focus to what opened it.
- Text contrast is at least 4.5:1. `--muted` passes on white (4.8:1) and only just on `--bg` (4.5:1). It fails on the grey chip `#f1f2f4` (4.3:1) and on `--accent-soft` (4.1:1): use `#5b6170` there.
- Keyboard shortcuts are ignored while typing or while a dialog is open.
- Motion respects `prefers-reduced-motion`.

## 9. Making a UI change

1. **Start here.** Name the parts of this guide that apply, and where the request departs from them.
2. **Mock it up first if the change is large.** That means more than one region of a page, or a new page. Use a Design canvas built with the portal's real colours and fonts, as with "Storyboard Arrange Cleanup", and agree it before writing code.
3. **Build it.** Use `sb-` buttons, `MenuButton`, the tokens and the words rules. Keep every existing action reachable unless removing it was decided.
4. **Look at it.** Render the real page with sample data at the sizes in section 6, and check the page does not scroll as a whole. (Running `next dev` in the repo overwrites CLAUDE.md: restore it with `git checkout CLAUDE.md next-env.d.ts`.)
5. **Have it reviewed.** An independent reviewer checks that every action is still reachable and that no CSS leaks into other pages.
6. **Update this guide** with any new rule or changed decision, and add a line to the decision log.

## 10. Open items

- **Meaning colours** (green, attention, error, AI) are written as raw hex in many places. Promote them to tokens (`--good`, `--attention`, `--error`, `--ai`) the next time several pages change together.
- **The two button systems** (`btn` and `sb-btn`) coexist. Move areas over when they are touched; no big-bang rewrite.
- **`ov-tag` has grown many one-off colour variants** (funder matches, triage, ground truth). These could collapse into the four meaning colours.
- **Notice styles overlap.** `ws-notice`, `ov-note`, `ws-soft-notice` and `ap-error` could become one component with a tone.
- **The original design** lives in `design/prototype.html`, the first clickable spec. Where it and this guide differ, this guide is newer.

## Decision log

| Date | Decision | By |
|---|---|---|
| 7 Oct 2026 | The page never scrolls as a whole; sidebar and main scroll on their own; the sidebar folds to a rail | Portal layout patch |
| 8 Oct 2026 | Layer colours, Option A: I gold, II purple, III light green; explanations behind ⓘ; one portal-wide Back button | Shane |
| 12 Oct 2026 | ⓘ boxes hidden with `display:none`; anything at the bottom opens upward | Action bar no-scroll fix |
| 16 Oct 2026 | Account for every item on a funder's form; nothing dropped silently | Shane (Form Items) |
| 17 Oct 2026 | Storyboard cleanup: the `sb-` button system, one primary per area, purple outline for AI, gold retired as a button colour, the question as the headline, ⋯ and More menus, "Arrange for me" removed, "Auto-draft all questions" | Shane (mockup "Storyboard Arrange Cleanup") |
| 17 Oct 2026 | This guide is a starting point for UI changes, not definitive truth | Shane |
| 17 Oct 2026 | Story Cards keep their layer-coloured borders and Verified / Needs review pills (the cleanup had swapped them for dots; reversed). Missing-setup notices such as "No approved Standard Answers yet" are flags, coloured to stand out | Shane |
| 17 Oct 2026 | Document Reader: highlights in the layer washes, yellow search matches, toggle chips, switches, phone bottom sheet; the Card Library's review card is drawn in the `sb-` system inside the reader only | Shane (mockup "Document Reader Mockup") |
