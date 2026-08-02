# 15 · BIOHACK PROTOCOL GENERATOR — Build Prompt for Claude Code

> **Editor's note — how this maps onto this repository.**
>
> This arrived numbered `14`, which is already `14-launch-readiness.md`, so it is filed as `15`.
> Three cross-references in the body do not resolve here and are worth knowing before you start:
>
> - **"docs/13 (biohacking hub)"** — `docs/13` in this repo is `13-spec-corrections.md`. There is
>   no biohacking-hub document yet. §0 and §4 below reference `docs/13 §6` for the banned-verb
>   linter; the compliance rules that linter must enforce live in **`docs/08 §7`**.
> - **"supersedes the Finder quiz in docs/05 §10"** — the Finder shipped in M10 and is live at
>   `/finder` with a deterministic scoring engine (`src/features/finder/`), 21 unit tests and its
>   own E2E. Superseding it means **replacing working, tested code**, not filling a gap. Read
>   `docs/13 §P7` and `features/finder/scoring.ts` before deleting anything: the budget-as-a-
>   constraint rule and the never-empty fallback are both hard-won and both belong in the new
>   engine.
> - **§0 rebrand** — already done, ahead of this prompt. See `docs/13 §R` and `docs/14 §16`. What
>   remains of §0 is listed under "§0 status" at the end of this document; do not re-run the
>   sweep blind.

Brand: **BioCode** (store), sub-brand **BioCode Labs** (the biohacking corner).
Feature: **BioHack Protocol Generator** — Albanian: **"Krijo Protokollin
BioHack"**. The customer selects 1–3 health goals, answers four refinements, and
the system **generates a personalized BioHack Protocol** — a premixed stack of
supplements _and_ habits with timing, phased onboarding, plain-language "why"
notes, and one-tap add-all-to-cart. Admins configure everything (mappings,
conflicts, caps, copy) without engineers, behind a compliance gate, with a live
simulator.

Read first: `CLAUDE.md`, `docs/02` (architecture), `docs/03` (database),
`docs/04` (design system), `docs/07` (commerce), `docs/08 §7` (compliance),
`docs/13` (biohacking hub — this generator is its centerpiece and **supersedes
the Finder quiz** in docs/05 §10).

## 0. GLOBAL REBRAND DIRECTIVES (execute first, whole repo)

The store was renamed **SHNETA → BioCode**. Before building this feature, sweep
the codebase and docs:

- Replace brand strings everywhere: `SHNETA → BioCode` (prose/UI), wordmark
  `SHNETA → BIOCODE`, `SHNETA LABS → BioCode Labs`. Update `i18n/messages/*`,
  seed `settings.store.name`, SEO title pattern (`… | BioCode`), email
  templates' header/footer, `EMAIL_FROM` (new verified BioCode domain — env,
  never hardcoded), Open Graph defaults, `app` manifest name, README/docs
  headers.
- Swap logo assets with the BioCode kit (same marks, new wordmark); favicon and
  app icon from the kit.
- **Do NOT rename database identifiers** (`protocol_*` tables, enums, RPCs stay
  as-is — internal names are brand-neutral by design). Do not rename git
  history, env var names, or bucket names.
- Feature naming in code: directory `src/features/biohack/`, admin route
  `/admin/biohack`, customer route `/biohack`. Old routes `/finder` and
  `/protokolli` 308-redirect to `/biohack`.
- Grep-verify zero remaining case-insensitive `shneta` matches outside
  migrations history notes before closing the milestone.

Non-negotiables inherited from the pack: TS strict, server actions + Zod +
ActionResult, RLS as the security boundary, money in cents, i18n jsonb + sq/en
messages, EFSA-safe claim language, doses never prescribed ("sipas etiketës"),
disclaimers on every generated output, all admin mutations audited.

---

## 1. Customer flow — 3 screens, under 60 seconds

**Route `/biohack`** (dynamic; noindex; linked from the BioCode Labs hub hero,
navbar Njohuri dropdown, and home "Bli sipas qëllimit" CTA). Page H1 / primary
CTA everywhere: **"Krijo Protokollin BioHack"** (EN: "Build your BioHack
Protocol"). In running copy the feature is "Gjeneratori BioHack"; a customer's
result is "Protokolli yt BioHack".

**Step 1 — Zgjidh qëllimet.** Grid of the 16 `health_goals` as selectable tiles
(icon, name). Multi-select **1–3**; a counter chip shows "2/3". Selecting a 4th
is blocked with a friendly note: "Deri në 3 — protokollet e fokusuara japin
rezultate më të matshme." Keyboard: tiles are toggle buttons; selection state
announced via `aria-pressed` + live region.

**Step 2 — Përshtate.** One screen of refinements (Zod-validated):

- Dieta: `pa kufizime | vegjetarian | vegan` → filters product resolution by
  `dietary_tags`.
- Kafeina: `po | jo | vetëm në mëngjes`.
- "A jeni shtatzënë, me gjidhënie, ose nën 18 vjeç?" `po/jo` — **hard gate**: if
  yes, do not generate; render the safe-guidance screen (§6).
- "A merrni medikamente të rregullta?" `po/jo` — if yes, exclude all ingredients
  flagged `med_sensitive` and show a persistent caution banner on the result.
- Niveli: `fillestar | i avancuar` (controls phasing, §3.7).
- Buxheti (optional): `deri 20 € | 20–40 € | 40+ € / muaj`.

**Step 3 — Protokolli yt BioHack.** Generated result page:

- Hero: auto title "Protokolli yt BioHack: {Gjumë + Stres}", duration (default
  28 ditë), evidence summary chips, phase indicator if phased, BioCode Labs
  eyebrow.
- **Day timeline** grouped Mëngjes / Ditë / Mbrëmje. Each supplement item card:
  product image, name, variant, price, timing note, evidence chip, and a
  **"PSE"** line that names the user's own goals ("Sepse zgjodhe _Gjumë_ dhe
  _Stres_ — magnezi kontribuon te të dyja."). Habit items (no price, lime-outline
  style) interleave: "Dritë dielli 10 min para orës 10:00."
- Per-item **"Ndërro"** swaps in the next-ranked alternative for that goal;
  **"Hiq"** removes (totals update).
- Cautions callout when any item carries one; medication banner when applicable.
- **Metrics checklist** ("Çfarë të masësh"): union of the selected goals' metric
  templates; screenshot-friendly card.
- Sticky footer: total "€/muaj" + primary **"Shto gjithçka në shportë"** (one
  action adds every in-stock line) + secondary **"Ruaje"** (account save; guests
  are prompted to sign in, state preserved) + **"Kthe në abonim"** (creates the
  stack as a 30-day subscription per docs/07 §8) + share icon → read-only page
  `/p/[code]` (noindex).
- Transparency: "Si u zgjodh ky protokoll?" expands the plain-language trace
  (§3.9) — scores, synergies, exclusions. Trust is the feature.
- Mandatory strip: "Edukative — jo këshillë mjekësore. Dozat sipas etiketës."
- States: every step has loading skeletons; degenerate results handled per §6.

## 2. Data model (one migration; follow docs/03 conventions)

```sql
create type timing_slot as enum ('mengjes','dite','mbremje','para_gjumit','me_ushqim','para_stervitjes');
create type conflict_kind as enum ('exclude','caution','timing_rule');

create table protocol_configs (          -- versioned, compliance-gated
  id uuid primary key default gen_random_uuid(),
  version int generated always as identity,
  status text not null default 'draft' check (status in ('draft','pending_review','approved','archived')),
  approved_by uuid references profiles(id), approved_at timestamptz,
  notes text, created_by uuid references profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table protocol_blocks (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references protocol_configs(id) on delete cascade,
  goal_id uuid not null references health_goals(id),
  ingredient_id uuid references ingredients(id),          -- null => habit block
  habit_i18n jsonb,                                       -- {"sq":..., "en":...} when habit
  weight int not null check (weight between 1 and 100),
  is_core boolean not null default false,
  timing timing_slot[] not null default '{mengjes}',
  phase int not null default 1 check (phase in (1,2)),
  why_i18n jsonb not null,                                -- EFSA-safe "PSE" copy
  evidence evidence_level,                                -- optional override
  caution_i18n jsonb,
  active boolean not null default true,
  check (ingredient_id is not null or habit_i18n is not null)
);
create table protocol_conflicts (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null references protocol_configs(id) on delete cascade,
  a_ingredient uuid references ingredients(id),
  b_ingredient uuid references ingredients(id),
  b_goal uuid references health_goals(id),                -- ingredient×goal rules (kafeinë × gjumi)
  kind conflict_kind not null,
  rule jsonb not null default '{}',                       -- {"allowed_slots":["mengjes"]} | {"separate_slots":true}
  note_i18n jsonb
);
create table generated_protocols (
  id uuid primary key default gen_random_uuid(),
  share_code text unique not null,                        -- short, unguessable
  user_id uuid references profiles(id),                   -- null for guests
  config_version int not null,
  inputs jsonb not null, result jsonb not null,           -- full snapshot => reproducible forever
  created_at timestamptz not null default now()
);
alter table ingredients add column if not exists med_sensitive boolean not null default false;
alter table ingredients add column if not exists contains_caffeine boolean not null default false;
alter table health_goals add column if not exists metrics_i18n jsonb;  -- ["Cilësia e gjumit (1–10)", ...]
```

Settings keys (settings table): `biohack_engine {max_items:5, min_items:2,
max_goals:3, per_goal_core_guarantee:true, duration_days:28, budget_tiers:
[2000,4000], subscription_convert:true}`.

RLS: config tables — staff read; `product_manager`+`admin` write; storefront
never queries them directly (engine runs server-side with the service client
against the **latest approved** config only). `generated_protocols` — insert via
action only; select own rows; share access via RPC `get_shared_protocol(code)`
(security definer, returns result jsonb only). Audit every config mutation.

## 3. The engine — pure, deterministic, tested (`src/features/biohack/engine.ts`)

A pure function; no I/O. Same inputs + same config ⇒ byte-identical output
(sorted tiebreaks by ingredient slug). Signature:
`generateProtocol(config, catalog, inputs): ProtocolResult`.

1. **Gate.** pregnancy/nursing/under-18 ⇒ return `{gated:true}` (§6).
2. **Candidates.** Active blocks whose `goal_id ∈ inputs.goals`.
3. **Synergy scoring.** Group by ingredient (habits by normalized text): score =
   Σ weight over the user's selected goals. An ingredient serving two chosen
   goals rises naturally — the premix effect.
4. **Filters.** Drop: `med_sensitive` when medication=yes; caffeine blocks when
   kafeina=jo; vegan/vegjetarian conflicts at _product resolution_ (step 8) with
   ingredient-level fallback drop if no compliant product exists.
5. **Conflicts.** Apply matrix in order: `exclude` (drop the lower-scored side;
   record in trace), `timing_rule` (constrain slots, e.g. kafeinë×gjumi ⇒
   allowed_slots=[mengjes] — and if kafeina="vetëm në mëngjes" this composes),
   `caution` (attach note).
6. **Selection.** Guarantee ≥1 highest-scored `is_core` block per selected goal;
   fill remaining slots (≤ max_items) globally by score; enforce min_items. If
   budget tier set: greedy by score-per-€ until tier fits, never dropping the
   per-goal core guarantee.
7. **Phasing.** niveli=fillestar ⇒ phase-2 blocks start day 8 ("Java 2: shto…");
   i avancuar ⇒ all phase 1.
8. **Product resolution.** ingredient ⇒ published product with matching
   `product_ingredients`, in stock, dietary-compliant; rank: is_featured desc,
   rating desc, price-per-serving asc; attach default variant + price. No stock ⇒
   substitute next-ranked same-goal ingredient; none ⇒ keep as "së shpejti" item
   (visible, not purchasable, excluded from totals).
9. **Trace.** Human-readable decision log (both locales): candidates, synergies,
   exclusions with reasons, budget cuts. Rendered in the customer expander and,
   verbatim, in the admin simulator.
10. **Result.** `{title, duration, phases, items[{kind, ingredient|habit,
product?, timing, phase, why, evidence, caution?}], metrics[], totals,
trace, config_version, disclaimer:true}`.

Server action `buildProtocol` = Zod-validate → rate-limit (10/h, reuse
check_rate_limit) → load approved config (cached, revalidated on approval) →
engine → persist `generated_protocols` → return result. p95 < 300 ms.

## 4. Admin — `/admin/biohack` (product_manager builds, compliance approves, admin settings)

- **Matrix** tab: goal picker → ranked block list (drag to reorder = weight),
  inline create (ingredient search or habit text), chips for timing/phase/core,
  sq/en "PSE" and caution copy with the banned-verb linter from docs/13 §6
  (warn on save; hard-block on the banned list).
- **Conflicts** tab: pair/goal picker, kind, rule editor, note.
- **Settings** tab: engine settings keys above.
- **Simulator** tab (build this first — it is the admin's eyes): choose any goal
  combo + refinements ⇒ instant generation against the _draft_ config, full
  trace, diff vs the approved version. No writes.
- **Versioning:** "Dërgo për miratim" ⇒ pending_review; compliance sees a diff
  of all copy + rules, approves ⇒ storefront switches atomically (revalidate
  engine-config cache). Storefront always pins the latest approved version;
  drafts can never leak. Everything audited.
- **Analytics** card: generations/day, top goal combos, add-all conversion,
  most-swapped items (curation feedback loop).

## 5. Seed the config (make it work on day one)

Approved config v1 covering all 16 goals, ≥3 blocks each, including at least:
gjumi → magnez bisglicinat (core, mbremje, w90) + L-theanine (mbremje, w70) +
habit "pa ekrane 60 min para gjumit" (core, w80); stresi → ashwagandha (core,
w90, caution shtatzëni) + magnez (w75); energjia → B12 (core, mengjes) + D3
(mengjes, me_ushqim) + habit "dritë dielli 10 min" (core); truri → kafeinë+
L-theanine pairing (mengjes, contains_caffeine) + kreatinë (w80) + omega-3;
imuniteti → C (core) + D3 + zink (caution: mos e merr esëll). Conflicts: kafeinë
× gjumi (timing_rule mengjes + caution), melatonin × mengjes slots (exclude),
ashwagandha med_sensitive=true. Mark caffeine/med flags on seed ingredients;
fill `health_goals.metrics_i18n` for all 16.

## 6. Edge & empty states (all designed, all tested)

Gated (pregnancy/nursing/minor): warm screen, no products — "Për këtë fazë,
protokollet i ndërton vetëm një profesionist shëndetësor" + link to general
knowledge articles. Conflicting selection wipes result below min_items:
generate the maximal safe subset + explain in trace + suggest removing a goal.
Zero stock across a goal: goal chip renders "së shpejti" and trace explains.
Guest save: full state survives the auth round-trip (encode inputs in the
redirect, regenerate deterministically).

## 7. Tests (extend docs/09)

Unit, table-driven, ≥25 cases: synergy math, per-goal core guarantee, caps,
budget greedy with guarantee intact, every conflict kind, caffeine composition
("jo" vs "vetëm në mëngjes" × gjumi rule), med gate, vegan resolution fallback,
phasing, determinism (deep-equal on repeated runs), substitution, "së shpejti".
Integration: RLS on config/generated tables; approval flips storefront version;
share RPC exposes result only. E2E: full 3-step flow → add-all → cart contains
exact lines → convert-to-subscription; gated path; swap updates totals; axe on
all three steps + result. Plus §0: repo-wide grep proves zero `shneta` matches.

## 8. Build order (one milestone, ~sessions in this order)

§0 rebrand sweep → migration+RLS+seed config → engine + full unit suite →
simulator (admin) → customer 3 steps + result page → add-all / save / share /
subscription convert → matrix & conflicts & settings admin + versioning/approval
→ analytics card → E2E + a11y + perf pass.

**Definition of done:** all §7 green; a customer opens **Krijo Protokollin
BioHack**, picks _Gjumë + Stres_, vegan, no caffeine, and in <60 s holds a
phased 5-item Protokoll BioHack where magnez appears once with a two-goal "PSE",
kafeinë is absent, every price is live, add-all lands 4 products in the cart in
one action, the trace reads like a human explanation in Albanian, compliance can
point to the approved config version that produced it — and not a single
"shneta" string survives anywhere in the repo.

---

## §0 status — what the rebrand already did, and what it did not

The rebrand ran ahead of this prompt. Recorded in `docs/13 §R` and `docs/14 §16`.

### Done

| §0 item                 | State                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Brand strings           | 191 files. Zero case-insensitive `shneta` matches remain outside one deliberate historical note in `scripts/seed-users.ts` |
| Wordmark                | `BIOCODE` in `components/storefront/brand-mark.tsx`, with a new sequence-tile mark                                         |
| `i18n/messages/*`       | Both locales, including new taglines and hero                                                                              |
| `settings.store.name`   | Seed **and** the live row                                                                                                  |
| Manifest, OG defaults   | Name, short name, `theme_color` = the kit's deep panel `#0B241B`                                                           |
| README, CLAUDE.md, docs | All 15 documents                                                                                                           |
| Palette                 | **Unchanged** — the brand kit keeps forest / lime / cream (docs/13 §R1)                                                    |
| Seeded content rows     | Article and product slugs migrated in the live database, then rebuilt (docs/13 §R4)                                        |

### Not done — decisions needed before this milestone starts

1. **Prose casing.** This prompt specifies `BioCode` in prose and `BIOCODE` only as the wordmark.
   The sweep used `BIOCODE` everywhere. Reconciling is a second pass over UI copy, docs and email
   templates — mechanical, but it changes ~50 user-visible strings and every doc heading.
2. **`SHNETA LABS → BioCode Labs`.** There is no Labs sub-brand in the codebase yet; it arrives
   with this feature.
3. **`EMAIL_FROM` / verified domain.** Still the owner task in `docs/14 §6`. No domain is
   registered, so there is nothing to verify and fourteen templates remain inert.
4. **Logo asset kit.** The mark is drawn in SVG in the component. There is no favicon or app-icon
   file yet — `pnpm seed:images` is still outstanding (`docs/14 §8`).
5. **`/finder` → `/biohack` redirect.** Not added, because `/finder` is currently the live,
   tested Finder. It should be added in the same change that supersedes it, not before.

### One thing to weigh before superseding the Finder

`/finder` is not a stub. It ships a deterministic pure-function scorer with 21 unit tests, a
five-step URL-state quiz whose back button works without state management, and an E2E that
asserts the <60 s acceptance criterion. Two of its rules were bought with real bugs and should
survive into the BioHack engine:

- **A budget is a constraint, not a preference** (docs/13 §P7). The first version trimmed to fit
  the budget and then topped back up to the minimum item count, quietly undoing it.
- **Results are never empty**, with the fallback labelled as a fallback rather than passed off as
  a match (docs/05 §10 acceptance).

The BioHack engine's §3.6 "never dropping the per-goal core guarantee" is the same class of rule
as the first, and §6's degenerate-result handling the same as the second. Port the tests, not just
the intent.

---

## Build log — what shipped, and where each §0 item landed

Built in the order §8 prescribes. Recorded in `docs/13 §T` and `docs/14 §17`.

### The five §0 items, resolved

1. **Prose casing.** Still `BIOCODE` everywhere, deliberately, with one exception: the eyebrow
   above the generator reads **BioCode Labs**, because that is the sub-brand's own casing. A
   ~50-string sweep to change prose casing would touch every doc heading and every email template
   for a typographic preference, and doing it in the same change as a feature would make both
   unreviewable. Still open.
2. **BioCode Labs.** Arrived here, as the eyebrow on `/biohack`, on the result page, and on the
   share page. No separate hub page — the sub-brand is a label on this feature, not a section.
3. **`EMAIL_FROM` / verified domain.** Resolved before this milestone: `shtrejt.com` is registered
   and verified with Resend (docs/13 §S).
4. **Logo asset kit.** Resolved before this milestone (docs/14 §16). `pnpm seed:images` is still
   outstanding and unrelated.
5. **`/finder` → `/biohack`.** Done, in the change that superseded it — 308 from both locales,
   route and feature deleted, both hard-won rules ported as named tests (docs/05 §10).

### Where the build departed from this document, and why

| Spec asked for                    | Built instead                                                                                                                                                                    | Reason                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Goal tiles as `aria-pressed` toggle buttons | A checkbox group in a `GET` form                                                                                                                                        | Native semantics for "choose several", announces itself without an ARIA attribute to get wrong, and step 1 works with JavaScript off — docs/01 §4's target device is a mid-range Android on mobile data |
| Step 3 as the third screen of one route | A stored protocol at `/biohack/[code]`                                                                                                                                     | A result has to survive a reload, a bookmark, a sign-in round trip and being sent to someone (docs/13 §T6). It also made the §6 guest round trip disappear (§T7) |
| Result page regenerates from the answers | Renders the stored snapshot                                                                                                                                               | Otherwise reopening a link after a catalogue change silently returns a different protocol, and "compliance can point at the version that produced it" becomes false |
| Drag-to-reorder = weight          | A weight number field                                                                                                                                                            | Weight sums across goals — that is the synergy mechanism. A drag handle orders one list and cannot express the number |
| Banned-verb linter "warn on save" | Hard block, both locales, shared with the config's integration test                                                                                                              | The reviewer who would catch it does not exist for this copy: it is recombined and generated at a customer, never read as a page (docs/13 §T10) |
| Per-item "next-ranked alternative" | Six ranked alternates shipped in the payload, swapped client-side                                                                                                               | Most alternates serve more than one chosen goal, so per-item lists would ship the same object repeatedly. A flat pool also makes swap and remove pure client state, which is what keeps a shared link stable |

### Definition of done, line by line

> _a customer opens **Krijo Protokollin BioHack**, picks Gjumë + Stres, vegan, no caffeine, and in
> <60 s holds a phased Protokoll BioHack where magnez appears once with a two-goal "PSE", kafeinë
> is absent, every price is live, add-all lands the products in the cart in one action, the trace
> reads like a human explanation in Albanian, compliance can point to the approved config version
> that produced it — and not a single "shneta" string survives anywhere in the repo._

All asserted, split across three suites:

- **<60 s, magnesium once with both goals, live prices, add-all** — `e2e/biohack.spec.ts`, which
  times the whole flow from `/biohack` to the result page.
- **Magnesium at score 165 carrying `gjumi` + `stresi`, no non-vegan product, every variant real**
  — `tests/integration/biohack.test.ts`, against the shipped config and the live catalogue.
- **The trace in Albanian** — rendered from `TraceKind` + subjects, so the engine stays pure and
  the sentence is written in the UI. Asserted in the E2E by opening the expander.
- **Compliance can point at the version** — `config_version` is stored on every row and shown as
  a chip on the result page.
- **No `shneta` string** — one deliberate historical note in `scripts/seed-users.ts`, unchanged.

One clause is **not** met, and knowingly: *kafeinë is absent* passes trivially, because the
catalogue has no caffeinated product to exclude. See docs/14 §17.
