'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { TraceEntry, TraceKind } from '@/features/biohack/types';

/**
 * docs/15 §3.9 — "Si u zgjodh ky protokoll?", the decision log in plain language.
 *
 * The engine emits a kind plus its subjects, never a sentence, so the wording lives here and the
 * same trace renders in Albanian, in English, and verbatim in the admin simulator. That split is
 * also what keeps the engine pure: prose in a pure function would have to be produced twice and
 * would make every unit assertion a string comparison.
 *
 * A `<details>` element rather than a controlled disclosure — it opens without JavaScript, it is
 * keyboard operable by default, and the browser handles the expanded state announcement.
 */

/**
 * `as const` is load-bearing: without it the values widen to `string` and next-intl's typed `t`
 * rejects them. Widening here would also mean a renamed message key fails at runtime instead of
 * at build time, which is exactly what CLAUDE.md §3 asks the key union to prevent.
 */
const MESSAGE = {
  candidate: 'traceCandidate',
  synergy: 'traceSynergy',
  profile_boost: 'traceProfileBoost',
  profile_demote: 'traceProfileDemote',
  profile_excluded: 'traceProfileExcluded',
  profile_required: 'traceProfileRequired',
  excluded_medication: 'traceExcludedMedication',
  excluded_caffeine: 'traceExcludedCaffeine',
  excluded_diet: 'traceExcludedDiet',
  excluded_conflict: 'traceExcludedConflict',
  timing_constrained: 'traceTimingConstrained',
  caution_attached: 'traceCautionAttached',
  core_guaranteed: 'traceCoreGuaranteed',
  budget_cut: 'traceBudgetCut',
  no_stock: 'traceNoStock',
  phase_deferred: 'tracePhaseDeferred',
} as const satisfies Record<TraceKind, string>;

export function ProtocolTrace({
  trace,
  goalNames,
}: {
  trace: TraceEntry[];
  goalNames: Record<string, string>;
}) {
  const t = useTranslations('biohack');
  if (trace.length === 0) return null;

  /**
   * Every message names `{subject}`, and several name `{object}`, `{score}` or `{detail}`.
   * next-intl throws on a missing placeholder rather than rendering a blank, so all four are
   * always supplied — an entry that has no object shows the subject again rather than a gap.
   */
  const line = (entry: TraceEntry): string => {
    const label = (value: string | undefined): string => {
      if (!value) return '';
      return goalNames[value] ?? humanise(value);
    };

    return t(MESSAGE[entry.kind], {
      subject: label(entry.subject),
      object: label(entry.object) || label(entry.subject),
      score: entry.score ?? 0,
      detail: entry.detail
        ? entry.detail
            .split(/[+,]/)
            .map((part) => label(part.trim()))
            .join(' + ')
        : '',
    });
  };

  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 font-ui text-sm font-semibold text-forest-900 marker:content-none">
        {t('traceToggle')}
        <ChevronDown
          className="size-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="border-t border-line p-4">
        <p className="text-sm text-ink-600">{t('traceIntro')}</p>
        <ol className="mt-3 flex flex-col gap-1.5">
          {trace.map((entry, index) => (
            <li
              // The trace is an ordered log, not a set: two identical entries are two real
              // decisions and the index is the only thing that distinguishes them.
              key={`${entry.kind}-${entry.subject}-${index}`}
              className="text-sm text-ink-600"
            >
              {line(entry)}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

/** `magnesium-bisglycinate` → `Magnesium bisglycinate`. Slugs are the fallback, not the goal. */
function humanise(slug: string): string {
  const text = slug.replace(/^habit:/, '').replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
