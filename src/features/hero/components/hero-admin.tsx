'use client';

import { useActionState, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Pin, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { pickLocale } from '@/lib/i18n';
import { storageUrl } from '@/lib/storage';
import {
  deleteHeroSlide,
  duplicateHeroSlide,
  moveHeroSlide,
  saveAnnouncement,
  saveHeroSettings,
  saveIntentBand,
  saveTrustStrip,
  toggleHeroSlide,
  type HeroState,
} from '@/features/hero/admin-actions';
import type {
  AdminAnnouncement,
  AdminHeroSlide,
} from '@/features/hero/admin-queries';
import type { HeroSettings, TrustItem } from '@/features/hero/types';
import type { AdminIntentTile } from '@/features/hero/admin-queries';
import { INTENT_ICONS } from '@/features/hero/admin-schemas';
import { SlideEditor } from '@/features/hero/components/slide-editor';

/**
 * docs/06 — the homepage hero console.
 *
 * Admin UI is English-only in v1 (CLAUDE.md §3), so the chrome here is literals. The *content* it
 * edits is bilingual and every text field appears as an SQ/EN pair side by side, which is the point:
 * a translation you have to remember to go and do somewhere else is a translation that does not get
 * done, and the publish rule refuses a half-translated slide.
 */

const TABS = ['slides', 'settings', 'intent', 'trust', 'announcement'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  slides: 'Slides',
  settings: 'Carousel',
  intent: 'Homepage tiles',
  trust: 'Trust strip',
  announcement: 'Announcement bar',
};

/**
 * Keeps a rejected submission in the form, and surfaces its field errors.
 *
 * React 19 resets an uncontrolled form after a function  completes — success or failure, it
 * makes no distinction — so a panel that failed validation came back blank and had to be retyped.
 * The submission is captured and re-seeded, keyed on the attempt so the inputs remount carrying the
 * echoed values rather than the saved row's.
 *
 * The field errors were being returned by every one of these actions and rendered by none of them,
 * which is how the panels came to say "Check the highlighted fields" while highlighting nothing.
 */
function useResilientForm(action: typeof saveAnnouncement) {
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [state, formAction] = useActionState(async (previous: HeroState, formData: FormData) => {
    const submitted = Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '']),
    );
    const result = await action(previous, formData);
    if (!result?.ok) {
      setDraft(submitted);
      setAttempt((current) => current + 1);
    }
    return result;
  }, null);

  const fieldErrors = state?.ok === false ? (state.fieldErrors ?? {}) : {};

  return {
    state,
    formAction,
    attempt,
    fieldErrors,
    val: (name: string, fallback: string) => draft?.[name] ?? fallback,
    checked: (name: string, fallback: boolean) => (draft ? draft[name] !== undefined : fallback),
  };
}

const FIELD_LABELS: Record<string, string> = {
  titleSq: 'Albanian',
  titleEn: 'English',
  linkLabel: 'Link label',
  href: 'Link',
  intervalSeconds: 'Interval',
};

/**
 * What is wrong, by name, rather than a sentence pointing at fields it does not identify.
 *
 * Falls back to the shared sentence when no field owns the failure — a permission refusal or a
 * database error has no input to attach itself to, and an empty list would be worse than a sentence.
 */
function Summary({ state, fieldErrors }: { state: HeroState; fieldErrors: Record<string, string[]> }) {
  if (!state) return null;
  if (state.ok) return <Feedback state={state} />;

  const named = Object.entries(fieldErrors);
  if (named.length === 0) return <Feedback state={state} />;

  return (
    <Alert tone="error" className="mt-3" title="Not saved">
      <p>Nothing has been lost — what you typed is still in the form. Fix these and save again:</p>
      <ul className="mt-2 list-disc pl-5">
        {named.map(([field, messages]) => (
          <li key={field}>
            <span className="font-medium">{FIELD_LABELS[field] ?? field}</span> — {messages.join(' ')}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/** The message under a field, wired to its input through `aria-describedby`. */
function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <span id={id} role="alert" className="text-xs text-error">
      {messages.join(' ')}
    </span>
  );
}

const ICON_CHOICES = ['truck', 'clock', 'flask', 'rotate', 'badge', 'wallet'] as const;
const SELECT = 'h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink-900';

export function Feedback({ state }: { state: HeroState }) {
  if (!state) return null;
  if (state.ok) {
    return (
      <Alert tone="success" className="mt-3">
        {state.data.message ?? 'Saved.'}
      </Alert>
    );
  }

  const message =
    state.error === 'admin.errors.forbidden'
      ? 'Your role cannot change the homepage hero.'
      : state.error === 'admin.hero.errors.notPublishable'
        ? 'A published slide needs a headline and a primary CTA in both languages, and a desktop image.'
        : state.error === 'admin.hero.errors.pinTaken'
          ? 'Another slide is already pinned.'
          : state.error === 'admin.hero.errors.fileTooLarge'
            ? 'That image is over 4 MB.'
            : state.error === 'admin.hero.errors.fileType'
              ? 'Images must be JPG, PNG, WebP or AVIF.'
              : state.error === 'admin.hero.errors.uploadFailed'
                ? 'The upload could not be started. Try again.'
                : state.error === 'admin.hero.errors.checkFields'
                  ? 'Check the highlighted fields.'
                  : 'Something went wrong. Try again.';

  return (
    <Alert tone="error" className="mt-3">
      {message}
    </Alert>
  );
}

/** A one-field form, so a row action needs no state of its own. */
function RowAction({
  id,
  action,
  label,
  children,
  extra,
}: {
  id: string;
  action: typeof deleteHeroSlide;
  label: string;
  children: React.ReactNode;
  extra?: Record<string, string>;
}) {
  const [, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <SubmitButton variant="ghost" size="sm" aria-label={label} title={label}>
        {children}
      </SubmitButton>
    </form>
  );
}

function SlidesPanel({ slides }: { slides: AdminHeroSlide[] }) {
  const [editing, setEditing] = useState<AdminHeroSlide | 'new' | null>(null);

  return (
    <div className="mt-4 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-600">
          Order is top to bottom. A pinned slide always shows first, including when shuffle is on.
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          New slide
        </Button>
      </div>

      {slides.length === 0 && (
        <Alert tone="info">No slides yet. The homepage hero is hidden until one is published.</Alert>
      )}

      <ul className="flex flex-col gap-3">
        {slides.map((slide, index) => (
          <li
            key={slide.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3"
          >
            <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md border border-line bg-cream">
              {slide.imageDesktopPath && (
                // Plain <img>: an admin thumbnail is not worth an optimisation pipeline, and the
                // path may be a public asset or a storage object.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={
                    slide.imageDesktopPath.startsWith('/')
                      ? slide.imageDesktopPath
                      : storageUrl('content', slide.imageDesktopPath)
                  }
                  alt=""
                  className="size-full object-cover"
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink-900">
                {pickLocale(slide.headline, 'en') || pickLocale(slide.headline, 'sq') || 'Untitled'}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                <span className={slide.status === 'published' ? 'text-success' : undefined}>
                  {slide.status}
                </span>
                {slide.isPinned && (
                  <span className="inline-flex items-center gap-1 text-forest-700">
                    <Pin className="size-3" aria-hidden="true" /> pinned
                  </span>
                )}
                {/* The "published but invisible" case, named rather than left to be discovered. */}
                {slide.scheduledOut && <span className="text-warning">outside its schedule</span>}
                {!pickLocale(slide.headline, 'sq') && (
                  <span className="text-warning">missing Albanian</span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-0.5">
              <RowAction
                id={slide.id}
                action={moveHeroSlide}
                extra={{ direction: 'up' }}
                label="Move up"
              >
                <ArrowUp className="size-4" aria-hidden="true" />
              </RowAction>
              <RowAction
                id={slide.id}
                action={moveHeroSlide}
                extra={{ direction: 'down' }}
                label="Move down"
              >
                <ArrowDown className="size-4" aria-hidden="true" />
              </RowAction>
              <RowAction
                id={slide.id}
                action={toggleHeroSlide}
                label={slide.status === 'published' ? 'Unpublish' : 'Publish'}
              >
                {slide.status === 'published' ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </RowAction>
              <RowAction id={slide.id} action={duplicateHeroSlide} label="Duplicate">
                <Copy className="size-4" aria-hidden="true" />
              </RowAction>
              <RowAction id={slide.id} action={deleteHeroSlide} label="Delete">
                <Trash2 className="size-4" aria-hidden="true" />
              </RowAction>
              <Button variant="secondary" size="sm" onClick={() => setEditing(slide)}>
                Edit
              </Button>
            </div>

            <span className="sr-only">Position {index + 1}</span>
          </li>
        ))}
      </ul>

      {editing && (
        <SlideEditor
          slide={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SettingsPanel({ settings }: { settings: HeroSettings }) {
  const { state, formAction, attempt, fieldErrors, val, checked } =
    useResilientForm(saveHeroSettings);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Carousel behaviour</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} key={attempt} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="autoplay"
              defaultChecked={checked('autoplay', settings.autoplay)}
              className="size-4"
            />
            Auto-advance
          </label>

          <label htmlFor="hero-interval" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Interval (seconds)</span>
            <Input
              id="hero-interval"
              name="intervalSeconds"
              type="number"
              min={3}
              max={15}
              defaultValue={val('intervalSeconds', String(settings.intervalSeconds))}
            />
          </label>

          <label htmlFor="hero-transition" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Transition</span>
            <select id="hero-transition" name="transition" defaultValue={val('transition', settings.transition)} className={SELECT}>
              <option value="fade">Crossfade</option>
              <option value="slide">Slide</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="loop"
              defaultChecked={checked('loop', settings.loop)}
              className="size-4"
            />
            Loop back to the first slide
          </label>

          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm text-ink-900">
              <input
                type="checkbox"
                name="shuffle"
                defaultChecked={checked('shuffle', settings.shuffle)}
                className="mt-0.5 size-4"
              />
              <span>
                Shuffle slide order
                <span className="mt-0.5 block text-xs text-ink-500">
                  Randomised once per page load, never mid-session. A pinned slide keeps first place
                  and the rest rotate behind it. Ignored when a visitor prefers reduced motion, or
                  when fewer than three slides are published.
                </span>
              </span>
            </label>
          </div>

          <div className="sm:col-span-2">
            <SubmitButton>Save carousel settings</SubmitButton>
          </div>
        </form>

        <Summary state={state} fieldErrors={fieldErrors} />
      </CardContent>
    </Card>
  );
}

function TrustPanel({ items }: { items: TrustItem[] }) {
  const { state, formAction, attempt, fieldErrors, val } = useResilientForm(saveTrustStrip);
  const rows = [0, 1, 2, 3].map((index) => items[index] ?? { icon: 'badge', sq: '', en: '' });

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Trust strip</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-ink-600">
          The quiet line under the carousel. It never rotates — these four facts are why someone
          completes a first order, and three of them being hidden at any moment defeats the purpose.
        </p>
        <p className="mt-2 text-sm text-ink-600">
          Write <code>{'{threshold}'}</code> where the free-shipping amount should go and it is filled
          in from the cheapest active shipping method, so changing that method updates the homepage
          rather than leaving it advertising an old number.
        </p>

        <form action={formAction} key={attempt} className="mt-4 flex flex-col gap-4">
          {rows.map((row, index) => (
            <div key={index} className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
              <label htmlFor={`trust-icon-${index}`} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink-900">Icon</span>
                <select id={`trust-icon-${index}`} name={`icon-${index}`} defaultValue={row.icon} className={SELECT}>
                  {ICON_CHOICES.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor={`trust-sq-${index}`} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink-900">Albanian</span>
                <Input
                  id={`trust-sq-${index}`}
                  name={`sq-${index}`}
                  defaultValue={val(`sq-${index}`, row.sq)}
                  maxLength={80}
                />
              </label>
              <label htmlFor={`trust-en-${index}`} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink-900">English</span>
                <Input
                  id={`trust-en-${index}`}
                  name={`en-${index}`}
                  defaultValue={val(`en-${index}`, row.en)}
                  maxLength={80}
                />
              </label>
            </div>
          ))}

          <div>
            <SubmitButton>Save trust strip</SubmitButton>
          </div>
        </form>

        <Summary state={state} fieldErrors={fieldErrors} />
      </CardContent>
    </Card>
  );
}

function AnnouncementPanel({ announcement }: { announcement: AdminAnnouncement | null }) {
  const { state, formAction, attempt, fieldErrors, val, checked } =
    useResilientForm(saveAnnouncement);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Announcement bar</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-ink-600">
          Sits above the navbar on every page. A visitor can dismiss it, and the dismissal is
          remembered against <em>this</em> announcement — publishing a new one shows it again to
          everyone rather than staying hidden for people who closed the last one.
        </p>

        <form action={formAction} key={attempt} className="mt-4 grid gap-4 sm:grid-cols-2">
          {announcement && <input type="hidden" name="id" value={announcement.id} />}

          <label htmlFor="ann-sq" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Albanian</span>
            <Input
              id="ann-sq"
              name="titleSq"
              defaultValue={val('titleSq', pickLocale(announcement?.title ?? {}, 'sq'))}
              maxLength={160}
              placeholder="15% zbritje në porosinë e parë"
              aria-invalid={Boolean(fieldErrors.titleSq)}
              aria-describedby={fieldErrors.titleSq ? 'ann-sq-error' : undefined}
            />
            <FieldError id="ann-sq-error" messages={fieldErrors.titleSq} />
          </label>
          <label htmlFor="ann-en" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">English</span>
            <Input
              id="ann-en"
              name="titleEn"
              defaultValue={val('titleEn', pickLocale(announcement?.title ?? {}, 'en'))}
              maxLength={160}
              placeholder="15% off your first order"
              aria-invalid={Boolean(fieldErrors.titleEn)}
              aria-describedby={fieldErrors.titleEn ? 'ann-en-error' : undefined}
            />
            <FieldError id="ann-en-error" messages={fieldErrors.titleEn} />
          </label>

          <label htmlFor="ann-link-label" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Link label</span>
            <Input
              id="ann-link-label"
              name="linkLabel"
              defaultValue={val('linkLabel', announcement?.linkLabel ?? '')}
              maxLength={40}
              placeholder="Become a partner"
              aria-invalid={Boolean(fieldErrors.linkLabel)}
              aria-describedby="ann-link-label-help"
            />
            <p id="ann-link-label-help" className="text-xs text-ink-600">
              The text on the clickable pill. Name it after where the link goes — e.g. “Become a
              partner”, “BioPartner”, “Shop now”. Leave the link empty to show it as plain text.
            </p>
            <FieldError id="ann-link-label-error" messages={fieldErrors.linkLabel} />
          </label>
          <label htmlFor="ann-href" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Link (optional)</span>
            <Input
              id="ann-href"
              name="href"
              defaultValue={val('href', announcement?.href ?? '')}
              placeholder="/offers"
              aria-invalid={Boolean(fieldErrors.href)}
              aria-describedby={fieldErrors.href ? 'ann-href-error' : undefined}
            />
            <FieldError id="ann-href-error" messages={fieldErrors.href} />
          </label>

          <div className="sm:col-span-2 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-900">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={checked('isActive', announcement?.isActive ?? false)}
                className="size-4"
              />
              Show the bar
            </label>
            <SubmitButton>Save announcement</SubmitButton>
          </div>
        </form>

        <Summary state={state} fieldErrors={fieldErrors} />
      </CardContent>
    </Card>
  );
}

/**
 * The four homepage entry tiles (migration 81).
 *
 * Six rows for four tiles on purpose: the band takes one to six, and an empty row is how a tile is added
 * without a button. Clearing a row's titles is how one is removed — the action drops rows with no title,
 * so add and remove are the same gesture as edit, which is the whole reason this is a fixed grid rather
 * than a list with controls.
 *
 * Order in the form is order on the page. No drag handle: six rows of six fields is already the densest
 * screen in the panel, and reordering by retyping four words is faster than learning a drag affordance
 * you use twice a year.
 */
function IntentPanel({ items }: { items: AdminIntentTile[] }) {
  const { state, formAction, attempt, fieldErrors, val } = useResilientForm(saveIntentBand);
  const rows = [0, 1, 2, 3, 4, 5].map(
    (index) =>
      items[index] ?? { icon: 'target', href: '', titleSq: '', titleEn: '', bodySq: '', bodyEn: '' },
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Homepage tiles</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-ink-600">
          The four cards under the trust strip. These are how somebody who ignored the hero finds their way
          in, so they are the most valuable navigation on the site — and which four they are is a
          merchandising decision, not a code change.
        </p>
        <p className="mt-2 text-sm text-ink-600">
          Leave a row&apos;s titles empty to drop that tile. Links must start with a single{' '}
          <code>/</code> —
          they go straight into the page, so an outside address is refused.
        </p>

        <form action={formAction} key={attempt} className="mt-4 flex flex-col gap-5">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-lg border border-line p-4">
              <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <label htmlFor={`intent-icon-${index}`} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink-900">Icon</span>
                  <select
                    id={`intent-icon-${index}`}
                    name={`icon-${index}`}
                    defaultValue={row.icon}
                    className={SELECT}
                  >
                    {INTENT_ICONS.map((icon) => (
                      <option key={icon} value={icon}>
                        {icon}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={`intent-href-${index}`} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink-900">Link</span>
                  <Input
                    id={`intent-href-${index}`}
                    name={`href-${index}`}
                    defaultValue={val(`href-${index}`, row.href)}
                    placeholder="/goals"
                    aria-invalid={Boolean(fieldErrors[`items.${index}.href`])}
                  />
                  <FieldError
                    id={`intent-href-${index}-error`}
                    messages={fieldErrors[`items.${index}.href`]}
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor={`intent-titleSq-${index}`} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink-900">Title — Albanian</span>
                  <Input
                    id={`intent-titleSq-${index}`}
                    name={`titleSq-${index}`}
                    defaultValue={val(`titleSq-${index}`, row.titleSq)}
                    maxLength={60}
                  />
                </label>
                <label htmlFor={`intent-titleEn-${index}`} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink-900">Title — English</span>
                  <Input
                    id={`intent-titleEn-${index}`}
                    name={`titleEn-${index}`}
                    defaultValue={val(`titleEn-${index}`, row.titleEn)}
                    maxLength={60}
                  />
                </label>
                <label htmlFor={`intent-bodySq-${index}`} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink-900">Line under it — Albanian</span>
                  <Input
                    id={`intent-bodySq-${index}`}
                    name={`bodySq-${index}`}
                    defaultValue={val(`bodySq-${index}`, row.bodySq)}
                    maxLength={120}
                  />
                </label>
                <label htmlFor={`intent-bodyEn-${index}`} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-ink-900">Line under it — English</span>
                  <Input
                    id={`intent-bodyEn-${index}`}
                    name={`bodyEn-${index}`}
                    defaultValue={val(`bodyEn-${index}`, row.bodyEn)}
                    maxLength={120}
                  />
                </label>
              </div>
            </div>
          ))}

          <div>
            <SubmitButton>Save tiles</SubmitButton>
          </div>
        </form>

        <Summary state={state} fieldErrors={fieldErrors} />
      </CardContent>
    </Card>
  );
}

export function HeroAdmin({
  slides,
  settings,
  intentTiles,
  trustItems,
  announcement,
}: {
  slides: AdminHeroSlide[];
  settings: HeroSettings;
  intentTiles: AdminIntentTile[];
  trustItems: TrustItem[];
  announcement: AdminAnnouncement | null;
}) {
  const [tab, setTab] = useState<Tab>('slides');

  return (
    <div className="mt-6">
      <div role="tablist" aria-label="Hero settings" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`hero-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`hero-panel-${name}`}
            onClick={() => setTab(name)}
            className={
              tab === name
                ? 'border-b-2 border-forest-800 px-3 py-2 text-sm font-medium text-forest-900'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-ink-600 hover:text-ink-900'
            }
          >
            {TAB_LABEL[name]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`hero-panel-${tab}`} aria-labelledby={`hero-tab-${tab}`}>
        {tab === 'slides' && <SlidesPanel slides={slides} />}
        {tab === 'settings' && <SettingsPanel settings={settings} />}
        {tab === 'intent' && <IntentPanel items={intentTiles} />}
        {tab === 'trust' && <TrustPanel items={trustItems} />}
        {tab === 'announcement' && <AnnouncementPanel announcement={announcement} />}
      </div>
    </div>
  );
}
