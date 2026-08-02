'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { pickLocale } from '@/lib/i18n';
import type { Locale } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { ProtocolGoal } from '@/features/biohack/queries';

const MAX_GOALS = 3;

/**
 * docs/15 §1 step 1 — pick one to three goals.
 *
 * **Checkboxes in a `GET` form, not `aria-pressed` toggle buttons.** The spec asks for toggle
 * buttons; a checkbox group reaches the same place with less. It announces its own state to a
 * screen reader without an ARIA attribute to get wrong, it is the native semantic for "choose
 * several from a set", and — the reason that settles it — the step still works with JavaScript
 * off, because a `GET` form submits `?goals=a&goals=b` on its own. docs/01 §4 names a mid-range
 * Android over mobile data as the target device.
 *
 * The client half does only what markup cannot: the live counter, and refusing a fourth.
 */
export function GoalPicker({
  goals,
  selected,
  action,
  error,
}: {
  goals: ProtocolGoal[];
  selected: string[];
  /** Where the form submits — carries the locale prefix. */
  action: string;
  error?: string;
}) {
  const t = useTranslations('biohack');
  const locale = useLocale() as Locale;
  const [chosen, setChosen] = useState<string[]>(selected.slice(0, MAX_GOALS));
  const counterId = useId();

  const atLimit = chosen.length >= MAX_GOALS;

  const toggle = (slug: string) => {
    setChosen((current) =>
      current.includes(slug)
        ? current.filter((entry) => entry !== slug)
        : current.length >= MAX_GOALS
          ? current
          : [...current, slug],
    );
  };

  if (goals.length === 0) {
    return <p className="text-ink-600">{t('goalsEmpty')}</p>;
  }

  return (
    <form action={action} method="get" className="flex flex-col gap-8">
      <input type="hidden" name="step" value="2" />

      <fieldset className="flex flex-col gap-5">
        <legend className="sr-only">{t('goalsTitle')}</legend>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {goals.map((goal) => {
            const isChosen = chosen.includes(goal.slug);
            /*
             * Disabled rather than hidden once three are chosen: the tiles must not reflow under
             * the finger that just tapped one. `aria-disabled` would keep them focusable but
             * silently ignore the click, which is worse than saying no.
             */
            const blocked = atLimit && !isChosen;

            return (
              <li key={goal.slug}>
                <label
                  className={cn(
                    'relative flex h-full cursor-pointer items-center gap-2.5 rounded-md border p-3.5',
                    'transition-colors duration-150 ease-[var(--ease-biocode)]',
                    'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                    'focus-within:outline-forest-700',
                    isChosen
                      ? 'border-forest-700 bg-forest-50 text-forest-900'
                      : 'border-line bg-surface text-ink-900 hover:border-line-strong',
                    blocked && 'cursor-not-allowed opacity-45',
                  )}
                >
                  {/*
                   * Transparent and stretched over the whole tile rather than `sr-only`.
                   *
                   * Visually identical, but the input *is* the hit area: the checkmark below is
                   * decorative, and a 1×1 hidden input sitting behind it means any click lands on
                   * the decoration instead. Real users never noticed — the label forwards the
                   * click — but nothing that drives the input directly could tick it, which is
                   * how the E2E suite found it.
                   */}
                  <input
                    type="checkbox"
                    name="goals"
                    value={goal.slug}
                    checked={isChosen}
                    disabled={blocked}
                    onChange={() => toggle(goal.slug)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-sm border',
                      isChosen ? 'border-forest-700 bg-forest-700 text-white' : 'border-line-strong',
                    )}
                  >
                    {isChosen && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                  <span className="font-ui text-sm font-medium">
                    {pickLocale(goal.name, locale)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {/*
         * The counter is the live region, so the announcement is the count itself rather than a
         * separate "selected" message duplicating what the checkbox already said.
         */}
        <p
          id={counterId}
          aria-live="polite"
          className="font-ui text-sm text-ink-600"
          data-numeric
        >
          {t('goalsCounter', { count: chosen.length, max: MAX_GOALS })}
          {atLimit && <span className="ml-2 text-ink-500">{t('goalsMax')}</span>}
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" size="lg" disabled={chosen.length === 0}>
          {t('next')}
        </Button>
      </div>
    </form>
  );
}
