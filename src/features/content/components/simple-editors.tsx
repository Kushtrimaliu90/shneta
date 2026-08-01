'use client';

import { useActionState, useState } from 'react';
import { HelpCircle, Megaphone, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  saveBanner,
  saveFaq,
  savePage,
  type ContentState,
} from '@/features/content/editor-actions';
import {
  BilingualField,
  Feedback,
  inputClass,
  labelClass,
} from '@/features/content/components/content-fields';
import type { BannerRow, FaqRow, PageRow } from '@/features/content/admin-queries';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  archived: 'Archived',
};

const PAGE_TITLES: Record<string, string> = {
  about: 'About us',
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  'shipping-returns': 'Shipping and returns',
};

/**
 * docs/06 §13 — the four fixed pages.
 *
 * Each is its own form so saving the privacy policy cannot touch the terms. They are the pages a
 * lawyer reviews; one accidental cross-save is a compliance problem, not a UI annoyance.
 */
export function PagesEditor({ pages }: { pages: PageRow[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {pages.map((page) => (
        <PageForm key={page.id} page={page} />
      ))}
    </ul>
  );
}

function PageForm({ page }: { page: PageRow }) {
  const [state, action] = useActionState<ContentState, FormData>(savePage, null);
  const [open, setOpen] = useState(false);

  const placeholder = page.body.sq.includes('[LEGAL: review]');

  return (
    <li className="rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-forest-50"
      >
        <span>
          <span className="font-medium text-ink-900">{PAGE_TITLES[page.slug] ?? page.slug}</span>
          <span className="block text-xs text-ink-500">/{page.slug}</span>
        </span>
        <span className="flex items-center gap-2">
          {/*
            docs/14 §3 lists the legal pages as blocking — they are seeded as placeholders and
            must be written before launch. Flagging it on the screen that fixes it is more useful
            than flagging it only in a ledger.
          */}
          {placeholder && (
            <span className="rounded-sm bg-warning px-1.5 py-0.5 font-ui text-[11px] font-semibold text-white">
              Placeholder text
            </span>
          )}
          <span className="text-xs text-ink-600">{STATUS_LABELS[page.status] ?? page.status}</span>
        </span>
      </button>

      {open && (
        <form action={action} className="border-t border-line p-4">
          <input type="hidden" name="id" value={page.id} />

          <BilingualField
            name="title"
            label="Title"
            sq={page.title.sq}
            en={page.title.en}
            state={state}
            required
          />
          <BilingualField
            name="body"
            label="Body"
            sq={page.body.sq}
            en={page.body.en}
            state={state}
            multiline
            rows={16}
            required
            hint="Markdown."
          />

          <div className="mt-4 max-w-xs">
            <label htmlFor={`status-${page.id}`} className={labelClass}>
              Status
            </label>
            <select
              id={`status-${page.id}`}
              name="status"
              defaultValue={page.status}
              className={inputClass}
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <SubmitButton size="sm" loadingLabel="Saving…">
              Save page
            </SubmitButton>
          </div>
          <Feedback state={state} />
        </form>
      )}
    </li>
  );
}

/** docs/06 §13 — FAQs, grouped by category and ordered by position. */
export function FaqsEditor({ faqs }: { faqs: FaqRow[] }) {
  const [creating, setCreating] = useState(false);

  const categories = [...new Set(faqs.map((faq) => faq.category))];
  const nextPosition = faqs.length > 0 ? Math.max(...faqs.map((f) => f.position)) + 10 : 0;

  return (
    <div>
      <div className="mb-4">
        {creating ? (
          <FaqForm faq={null} nextPosition={nextPosition} onDone={() => setCreating(false)} />
        ) : (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New question
          </Button>
        )}
      </div>

      {faqs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <HelpCircle className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">No questions yet</p>
        </div>
      ) : (
        categories.map((category) => (
          <section key={category} className="mt-6">
            <h3 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
              {category}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {faqs
                .filter((faq) => faq.category === category)
                .map((faq) => (
                  <FaqRowView key={faq.id} faq={faq} />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function FaqRowView({ faq }: { faq: FaqRow }) {
  const [open, setOpen] = useState(false);

  return (
    <li className={cn('rounded-sm border bg-surface', faq.isActive ? 'border-line' : 'border-line opacity-70')}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-forest-50"
      >
        <span className="text-ink-900">{faq.question.sq || '(no question)'}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
          {!faq.isActive && <span>Hidden</span>}
          {!faq.question.en && <span className="text-warning">No English</span>}
          <span data-numeric>#{faq.position}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line p-3">
          <FaqForm faq={faq} nextPosition={faq.position} onDone={() => setOpen(false)} />
        </div>
      )}
    </li>
  );
}

function FaqForm({
  faq,
  nextPosition,
  onDone,
}: {
  faq: FaqRow | null;
  nextPosition: number;
  onDone: () => void;
}) {
  const [state, action] = useActionState<ContentState, FormData>(saveFaq, null);

  return (
    <form action={action} className="rounded-sm border border-line-strong bg-surface p-3">
      {faq && <input type="hidden" name="id" value={faq.id} />}

      <BilingualField
        name="question"
        label="Question"
        sq={faq?.question.sq ?? ''}
        en={faq?.question.en ?? ''}
        state={state}
        required
      />
      <BilingualField
        name="answer"
        label="Answer"
        sq={faq?.answer.sq ?? ''}
        en={faq?.answer.en ?? ''}
        state={state}
        multiline
        rows={4}
        required
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`cat-${faq?.id ?? 'new'}`} className={labelClass}>
            Group <span className="text-error">*</span>
          </label>
          <input
            id={`cat-${faq?.id ?? 'new'}`}
            name="category"
            defaultValue={faq?.category ?? 'general'}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`pos-${faq?.id ?? 'new'}`} className={labelClass}>
            Order
          </label>
          <input
            id={`pos-${faq?.id ?? 'new'}`}
            name="position"
            type="number"
            min={0}
            defaultValue={faq?.position ?? nextPosition}
            required
            className={inputClass}
            data-numeric
          />
        </div>
        <label className="flex items-end gap-2 pb-2.5 text-sm text-ink-900">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={faq?.isActive ?? true}
            className="size-4 rounded-sm border-line-strong"
          />
          Shown on the FAQ page
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Saving…">
          {faq ? 'Save' : 'Create'}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** docs/06 §13 — banners, grouped by placement. */
export function BannersEditor({ banners }: { banners: BannerRow[] }) {
  const [creating, setCreating] = useState(false);
  const placements = [...new Set(banners.map((banner) => banner.placement))];

  return (
    <div>
      <div className="mb-4">
        {creating ? (
          <BannerForm banner={null} onDone={() => setCreating(false)} />
        ) : (
          <Button type="button" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New banner
          </Button>
        )}
      </div>

      {banners.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Megaphone className="mx-auto size-6 text-ink-500" aria-hidden="true" />
          <p className="mt-2 font-medium text-forest-900">No banners</p>
          <p className="mt-1.5 text-sm text-ink-600">
            Placements the shop reads: <span className="font-mono">home_hero</span>,{' '}
            <span className="font-mono">offers</span>.
          </p>
        </div>
      ) : (
        placements.map((placement) => (
          <section key={placement} className="mt-6">
            <h3 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
              {placement}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {banners
                .filter((banner) => banner.placement === placement)
                .map((banner) => (
                  <BannerRowView key={banner.id} banner={banner} />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function BannerRowView({ banner }: { banner: BannerRow }) {
  const [open, setOpen] = useState(false);

  const now = new Date().toISOString();
  const scheduled = banner.startsAt !== null && banner.startsAt > now;
  const expired = banner.endsAt !== null && banner.endsAt < now;

  return (
    <li className="rounded-sm border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-forest-50"
      >
        <span className="text-ink-900">{banner.title.sq || '(no title)'}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-500">
          {!banner.isActive && <span>Inactive</span>}
          {scheduled && <span className="text-forest-800">Scheduled</span>}
          {expired && <span className="text-warning">Expired</span>}
          <span data-numeric>#{banner.position}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line p-3">
          <BannerForm banner={banner} onDone={() => setOpen(false)} />
        </div>
      )}
    </li>
  );
}

function BannerForm({ banner, onDone }: { banner: BannerRow | null; onDone: () => void }) {
  const [state, action] = useActionState<ContentState, FormData>(saveBanner, null);
  const key = banner?.id ?? 'new';

  return (
    <form action={action} className="rounded-sm border border-line-strong bg-surface p-3">
      {banner && <input type="hidden" name="id" value={banner.id} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`placement-${key}`} className={labelClass}>
            Placement <span className="text-error">*</span>
          </label>
          <input
            id={`placement-${key}`}
            name="placement"
            defaultValue={banner?.placement ?? 'home_hero'}
            required
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`href-${key}`} className={labelClass}>
            Button link
          </label>
          <input
            id={`href-${key}`}
            name="ctaHref"
            defaultValue={banner?.ctaHref ?? ''}
            placeholder="/shop"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`bpos-${key}`} className={labelClass}>
            Order
          </label>
          <input
            id={`bpos-${key}`}
            name="position"
            type="number"
            min={0}
            defaultValue={banner?.position ?? 0}
            required
            className={inputClass}
            data-numeric
          />
        </div>
      </div>

      <BilingualField
        name="title"
        label="Title"
        sq={banner?.title.sq ?? ''}
        en={banner?.title.en ?? ''}
        state={state}
        required
      />
      <BilingualField
        name="subtitle"
        label="Subtitle"
        sq={banner?.subtitle.sq ?? ''}
        en={banner?.subtitle.en ?? ''}
        state={state}
      />
      <BilingualField
        name="ctaLabel"
        label="Button label"
        sq={banner?.ctaLabel.sq ?? ''}
        en={banner?.ctaLabel.en ?? ''}
        state={state}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`starts-${key}`} className={labelClass}>
            Shows from
          </label>
          <input
            id={`starts-${key}`}
            name="startsAt"
            type="date"
            defaultValue={banner?.startsAt?.slice(0, 10) ?? ''}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`ends-${key}`} className={labelClass}>
            Until
          </label>
          <input
            id={`ends-${key}`}
            name="endsAt"
            type="date"
            defaultValue={banner?.endsAt?.slice(0, 10) ?? ''}
            className={inputClass}
          />
        </div>
        <label className="flex items-end gap-2 pb-2.5 text-sm text-ink-900">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={banner?.isActive ?? true}
            className="size-4 rounded-sm border-line-strong"
          />
          Active
        </label>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SubmitButton size="sm" loadingLabel="Saving…">
          {banner ? 'Save' : 'Create'}
        </SubmitButton>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
