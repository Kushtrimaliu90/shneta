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
  saveTrustStrip,
  toggleHeroSlide,
  type HeroState,
} from '@/features/hero/admin-actions';
import type {
  AdminAnnouncement,
  AdminHeroSlide,
} from '@/features/hero/admin-queries';
import type { HeroSettings, TrustItem } from '@/features/hero/types';
import { SlideEditor } from '@/features/hero/components/slide-editor';

/**
 * docs/06 — the homepage hero console.
 *
 * Admin UI is English-only in v1 (CLAUDE.md §3), so the chrome here is literals. The *content* it
 * edits is bilingual and every text field appears as an SQ/EN pair side by side, which is the point:
 * a translation you have to remember to go and do somewhere else is a translation that does not get
 * done, and the publish rule refuses a half-translated slide.
 */

const TABS = ['slides', 'settings', 'trust', 'announcement'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  slides: 'Slides',
  settings: 'Carousel',
  trust: 'Trust strip',
  announcement: 'Announcement bar',
};

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
  const [state, action] = useActionState(saveHeroSettings, null);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Carousel behaviour</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input
              type="checkbox"
              name="autoplay"
              defaultChecked={settings.autoplay}
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
              defaultValue={settings.intervalSeconds}
            />
          </label>

          <label htmlFor="hero-transition" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Transition</span>
            <select id="hero-transition" name="transition" defaultValue={settings.transition} className={SELECT}>
              <option value="fade">Crossfade</option>
              <option value="slide">Slide</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-900">
            <input type="checkbox" name="loop" defaultChecked={settings.loop} className="size-4" />
            Loop back to the first slide
          </label>

          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm text-ink-900">
              <input
                type="checkbox"
                name="shuffle"
                defaultChecked={settings.shuffle}
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

        <Feedback state={state} />
      </CardContent>
    </Card>
  );
}

function TrustPanel({ items }: { items: TrustItem[] }) {
  const [state, action] = useActionState(saveTrustStrip, null);
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

        <form action={action} className="mt-4 flex flex-col gap-4">
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
                <Input id={`trust-sq-${index}`} name={`sq-${index}`} defaultValue={row.sq} maxLength={80} />
              </label>
              <label htmlFor={`trust-en-${index}`} className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-ink-900">English</span>
                <Input id={`trust-en-${index}`} name={`en-${index}`} defaultValue={row.en} maxLength={80} />
              </label>
            </div>
          ))}

          <div>
            <SubmitButton>Save trust strip</SubmitButton>
          </div>
        </form>

        <Feedback state={state} />
      </CardContent>
    </Card>
  );
}

function AnnouncementPanel({ announcement }: { announcement: AdminAnnouncement | null }) {
  const [state, action] = useActionState(saveAnnouncement, null);

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

        <form action={action} className="mt-4 grid gap-4 sm:grid-cols-2">
          {announcement && <input type="hidden" name="id" value={announcement.id} />}

          <label htmlFor="ann-sq" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Albanian</span>
            <Input
              id="ann-sq"
              name="titleSq"
              defaultValue={pickLocale(announcement?.title ?? {}, 'sq')}
              maxLength={160}
              placeholder="15% zbritje në porosinë e parë"
            />
          </label>
          <label htmlFor="ann-en" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">English</span>
            <Input
              id="ann-en"
              name="titleEn"
              defaultValue={pickLocale(announcement?.title ?? {}, 'en')}
              maxLength={160}
              placeholder="15% off your first order"
            />
          </label>

          <label htmlFor="ann-code" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Code</span>
            <Input id="ann-code" name="code" defaultValue={announcement?.code ?? ''} maxLength={40} />
          </label>
          <label htmlFor="ann-href" className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-900">Link (optional)</span>
            <Input id="ann-href" name="href" defaultValue={announcement?.href ?? ''} placeholder="/offers" />
          </label>

          <div className="sm:col-span-2 flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-900">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={announcement?.isActive ?? false}
                className="size-4"
              />
              Show the bar
            </label>
            <SubmitButton>Save announcement</SubmitButton>
          </div>
        </form>

        <Feedback state={state} />
      </CardContent>
    </Card>
  );
}

export function HeroAdmin({
  slides,
  settings,
  trustItems,
  announcement,
}: {
  slides: AdminHeroSlide[];
  settings: HeroSettings;
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
        {tab === 'trust' && <TrustPanel items={trustItems} />}
        {tab === 'announcement' && <AnnouncementPanel announcement={announcement} />}
      </div>
    </div>
  );
}
