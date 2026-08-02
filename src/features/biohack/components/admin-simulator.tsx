'use client';

import { useMemo, useState } from 'react';
import { generateProtocol } from '@/features/biohack/engine';
import { formatPrice } from '@/lib/money';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  CAFFEINE,
  DIETS,
  LEVELS,
  SLOT_DAY_PART,
  type CatalogProduct,
  type Caffeine,
  type Diet,
  type Level,
  type ProtocolConfig,
} from '@/features/biohack/types';

/**
 * docs/15 §4 — the simulator, built first because it is the admin's eyes.
 *
 * The **whole config and catalogue are shipped to the browser** and the engine runs there. That
 * is unusual for this codebase and it is the point: the engine is pure and about a millisecond,
 * so every change of an answer regenerates instantly with no round trip, and an editor can sweep
 * through twenty goal combinations in the time one server action would take. Nothing here writes.
 *
 * It also runs against the **draft**, which is the reason the tab exists — seeing what a rule
 * change does before compliance is asked to sign it. The customer-facing page never loads a
 * draft; that separation is enforced in `config-loader`, which only ever reads the approved
 * version.
 *
 * The trace is rendered raw — kinds, subjects and scores, not the customer's sentences. An editor
 * debugging a weight wants the data, and the translated version is one tab away on the storefront.
 */
export function AdminSimulator({
  config,
  catalog,
  goals,
  isDraft,
}: {
  config: ProtocolConfig;
  catalog: CatalogProduct[];
  goals: { slug: string; name: string }[];
  isDraft: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([goals[0]?.slug ?? '']);
  const [diet, setDiet] = useState<Diet>('pa_kufizime');
  const [caffeine, setCaffeine] = useState<Caffeine>('po');
  const [level, setLevel] = useState<Level>('fillestar');
  const [medication, setMedication] = useState(false);
  const [budget, setBudget] = useState<number | null>(null);

  const result = useMemo(
    () =>
      generateProtocol(config, catalog, {
        goals: selected.filter(Boolean),
        diet,
        caffeine,
        restrictedLifeStage: false,
        medication,
        level,
        budgetCents: budget,
      }),
    [config, catalog, selected, diet, caffeine, medication, level, budget],
  );

  const goalName = (slug: string) => goals.find((g) => g.slug === slug)?.name ?? slug;

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5">
        <div>
          <h2 className="font-display text-base font-semibold text-forest-900">Answers</h2>
          <p className="mt-0.5 text-xs text-ink-600">
            Runs against {isDraft ? 'the draft' : 'the approved version'} · v{config.version} ·{' '}
            {config.blocks.length} blocks
          </p>
        </div>

        <fieldset>
          <legend className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
            Goals (max {config.settings.maxGoals})
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {goals.map((goal) => {
              const on = selected.includes(goal.slug);
              const full = selected.length >= config.settings.maxGoals;
              return (
                <button
                  key={goal.slug}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(goal.slug)
                        ? current.filter((s) => s !== goal.slug)
                        : [...current, goal.slug],
                    )
                  }
                  className={cn(
                    'rounded-sm border px-2 py-1 text-xs transition-colors',
                    on
                      ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                      : 'border-line-strong text-ink-600 hover:bg-forest-50',
                    !on && full && 'cursor-not-allowed opacity-40',
                  )}
                >
                  {goal.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Choice label="Diet" value={diet} onChange={setDiet} options={DIETS} />
        <Choice label="Caffeine" value={caffeine} onChange={setCaffeine} options={CAFFEINE} />
        <Choice label="Level" value={level} onChange={setLevel} options={LEVELS} />

        <label className="flex items-center gap-2 text-sm text-ink-900">
          <input
            type="checkbox"
            checked={medication}
            onChange={(event) => setMedication(event.target.checked)}
            className="size-4 accent-forest-700"
          />
          On regular medication
        </label>

        <fieldset>
          <legend className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
            Budget
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[null, ...config.settings.budgetTiers].map((tier) => (
              <button
                key={tier ?? 'none'}
                type="button"
                aria-pressed={budget === tier}
                onClick={() => setBudget(tier)}
                className={cn(
                  'rounded-sm border px-2 py-1 text-xs transition-colors',
                  budget === tier
                    ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                    : 'border-line-strong text-ink-600 hover:bg-forest-50',
                )}
              >
                {tier === null ? 'No limit' : formatPrice(tier, 'en')}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-5 py-4">
          <Stat label="Items" value={String(result.items.length)} />
          <Stat label="Monthly" value={formatPrice(result.monthlyTotalCents, 'en')} />
          <Stat label="Phased" value={result.phased ? 'yes' : 'no'} />
          <Stat label="Alternates" value={String(result.alternates.length)} />
          <Stat label="Trace" value={String(result.trace.length)} />
        </div>

        {result.items.length === 0 && (
          <p className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-ink-900">
            This combination produces nothing. On the storefront that is the degenerate case in
            docs/15 §6 — check that the chosen goals have active blocks.
          </p>
        )}

        <ol className="flex flex-col gap-2">
          {result.items.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line bg-surface p-3 text-sm"
            >
              <span className="font-medium text-ink-900">{item.key}</span>
              <span className="rounded-sm bg-forest-100 px-1.5 py-0.5 font-ui text-[11px] font-semibold text-forest-900">
                {item.score}
              </span>
              <span className="text-xs text-ink-600">
                {item.goalSlugs.map(goalName).join(' + ')}
              </span>
              <span className="text-xs text-ink-600">
                {item.timing.map((slot) => `${slot}→${SLOT_DAY_PART[slot]}`).join(', ')}
              </span>
              <span className="text-xs text-ink-600">phase {item.phase}</span>
              {item.comingSoon && (
                <span className="rounded-sm bg-warning/20 px-1.5 py-0.5 text-[11px] font-semibold text-ink-900">
                  coming soon
                </span>
              )}
              {item.product && (
                <span className="ml-auto font-ui text-sm text-forest-900" data-numeric>
                  {formatPrice(item.product.priceCents, 'en')}
                </span>
              )}
              <p className="w-full text-xs text-ink-600">{item.why.en || item.why.sq}</p>
            </li>
          ))}
        </ol>

        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer p-4 text-sm font-semibold text-forest-900">
            Trace ({result.trace.length})
          </summary>
          <ol className="border-t border-line p-4 font-mono text-xs text-ink-600">
            {result.trace.map((entry, index) => (
              <li key={`${entry.kind}-${entry.subject}-${index}`}>
                {entry.kind} · {entry.subject}
                {entry.object ? ` → ${entry.object}` : ''}
                {entry.score !== undefined ? ` · ${entry.score}` : ''}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex flex-col">
      <span className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </span>
      <span className="font-ui text-lg font-semibold text-forest-900" data-numeric>
        {value}
      </span>
    </p>
  );
}

/** A one-line radio row. Typed on the option tuple so the setter stays narrow. */
function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
}) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
        {label}
      </legend>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={value === option ? 'primary' : 'secondary'}
            onClick={() => onChange(option)}
            className="h-8 px-2.5 text-xs"
          >
            {option}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
