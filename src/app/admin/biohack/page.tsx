import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { cn } from '@/lib/utils';
import { getProtocolCatalog } from '@/features/biohack/config-loader';
import {
  currentConfigId,
  listBlocks,
  listConfigs,
  listConflicts,
  listProfileRules,
  listGoalOptions,
  listIngredientOptions,
  protocolAnalytics,
  readAdminConfig,
} from '@/features/biohack/admin-queries';
import { AdminSimulator } from '@/features/biohack/components/admin-simulator';
import { AdminMatrix } from '@/features/biohack/components/admin-matrix';
import { AdminProfileRules } from '@/features/biohack/components/admin-profile-rules';
import {
  AdminConflicts,
  AdminEngineSettings,
  AdminVersions,
} from '@/features/biohack/components/admin-config-tabs';

export const metadata: Metadata = { title: 'BioHack' };

const TABS = [
  'simulator',
  'matrix',
  'profile',
  'conflicts',
  'settings',
  'versions',
  'analytics',
] as const;
type Tab = (typeof TABS)[number];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * docs/15 §4 — `/admin/biohack`.
 *
 * Six tabs behind `?tab=`, the same shape `/admin/content` uses for its status filter: each tab
 * is a URL, so a colleague can be sent a link to the conflict that is wrong, and the browser's
 * back button moves between tabs. No client-side tab state anywhere.
 *
 * **Every tab operates on one version** — the newest draft or pending version if one exists,
 * otherwise the approved one. That single rule is what stops the screen from being confusing:
 * once you start a draft, everything you see is the draft, including what the simulator runs.
 *
 * The layout has already proved the reader is staff; this proves the capability, because
 * `visibleNav` hiding a link is a courtesy and not a guard.
 */
export default async function AdminBioHackPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!can(profile?.role, 'biohack.view')) redirect('/admin');

  const editable = can(profile?.role, 'biohack.manage');
  const approver = can(profile?.role, 'compliance.approve');

  const params = await searchParams;
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : 'simulator';

  const configs = await listConfigs();
  const configId = await currentConfigId();

  if (!configId) {
    return (
      <section>
        <h1 className="font-display text-2xl font-semibold text-forest-900">BioHack</h1>
        <p className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-4 text-sm text-ink-900">
          No protocol config exists. The generator returns nothing until one is approved — apply
          the migration that seeds v1 (<code>20260802000310_protocol_config_v1.sql</code>).
        </p>
      </section>
    );
  }

  const active = configs.find((entry) => entry.id === configId);
  const isDraft = active?.status === 'draft';
  const canEditThis = editable && isDraft;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-forest-900">BioHack</h1>
          <p className="mt-1 text-sm text-ink-600">
            Working on v{active?.version} ({active?.status.replace('_', ' ')})
            {active?.approvedAt && ` · approved ${formatAdminDateTime(active.approvedAt)}`}
            {!canEditThis && editable && ' · read-only until you start a draft'}
          </p>
        </div>
      </header>

      <nav aria-label="BioHack sections" className="flex flex-wrap gap-1.5 border-b border-line pb-3">
        {TABS.map((entry) => (
          <Link
            key={entry}
            href={`/admin/biohack?tab=${entry}`}
            aria-current={entry === tab ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-xs capitalize transition-colors',
              entry === tab
                ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                : 'border-line-strong text-ink-600 hover:bg-forest-50',
            )}
          >
            {entry}
          </Link>
        ))}
      </nav>

      {tab === 'simulator' && <SimulatorTab configId={configId} isDraft={Boolean(isDraft)} />}
      {tab === 'matrix' && (
        <MatrixTab configId={configId} editable={canEditThis} params={params} />
      )}
      {tab === 'profile' && <ProfileTab configId={configId} editable={canEditThis} />}
      {tab === 'conflicts' && <ConflictsTab configId={configId} editable={canEditThis} />}
      {tab === 'settings' && <SettingsTab configId={configId} editable={editable} />}
      {tab === 'versions' && (
        <AdminVersions configs={configs} canEdit={editable} canApprove={approver} />
      )}
      {tab === 'analytics' && <AnalyticsTab />}
    </section>
  );
}

async function SimulatorTab({ configId, isDraft }: { configId: string; isDraft: boolean }) {
  const [config, catalog, goals] = await Promise.all([
    readAdminConfig(configId),
    getProtocolCatalog(),
    listGoalOptions(),
  ]);

  if (!config) return <p className="text-sm text-ink-600">This version could not be loaded.</p>;

  return (
    <AdminSimulator
      config={config}
      catalog={catalog}
      goals={goals.map((goal) => ({ slug: goal.slug, name: goal.name }))}
      isDraft={isDraft}
    />
  );
}

async function MatrixTab({
  configId,
  editable,
  params,
}: {
  configId: string;
  editable: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  const goals = await listGoalOptions();
  const requested = Array.isArray(params.goal) ? params.goal[0] : params.goal;
  const goalSlug = goals.some((g) => g.slug === requested)
    ? (requested as string)
    : (goals[0]?.slug ?? '');

  const [blocks, ingredients] = await Promise.all([
    listBlocks(configId, goalSlug),
    listIngredientOptions(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Choose a goal" className="flex flex-wrap gap-1.5">
        {goals.map((goal) => (
          <Link
            key={goal.slug}
            href={`/admin/biohack?tab=matrix&goal=${goal.slug}`}
            aria-current={goal.slug === goalSlug ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-8 items-center rounded-sm border px-2.5 text-xs transition-colors',
              goal.slug === goalSlug
                ? 'border-forest-800 bg-forest-100 font-medium text-forest-900'
                : 'border-line-strong text-ink-600 hover:bg-forest-50',
            )}
          >
            {goal.name}
          </Link>
        ))}
      </nav>

      <AdminMatrix
        configId={configId}
        editable={editable}
        goals={goals}
        ingredients={ingredients}
        goalSlug={goalSlug}
        blocks={blocks}
      />
    </div>
  );
}

async function ProfileTab({ configId, editable }: { configId: string; editable: boolean }) {
  const [rules, ingredients, goals] = await Promise.all([
    listProfileRules(configId),
    listIngredientOptions(),
    listGoalOptions(),
  ]);

  return (
    <AdminProfileRules
      configId={configId}
      editable={editable}
      rules={rules}
      ingredients={ingredients}
      goals={goals}
    />
  );
}

async function ConflictsTab({ configId, editable }: { configId: string; editable: boolean }) {
  const [conflicts, ingredients, goals] = await Promise.all([
    listConflicts(configId),
    listIngredientOptions(),
    listGoalOptions(),
  ]);

  return (
    <AdminConflicts
      configId={configId}
      editable={editable}
      conflicts={conflicts}
      ingredients={ingredients}
      goals={goals}
    />
  );
}

async function SettingsTab({ configId, editable }: { configId: string; editable: boolean }) {
  const config = await readAdminConfig(configId);
  if (!config) return <p className="text-sm text-ink-600">Settings could not be loaded.</p>;
  if (!editable) {
    return <p className="text-sm text-ink-600">Your role can view the ruleset but not change it.</p>;
  }

  return <AdminEngineSettings settings={config.settings} />;
}

async function AnalyticsTab() {
  const stats = await protocolAnalytics();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card label="Protocols generated" value={stats.total} note="most recent 500" />
        <Card label="Last 7 days" value={stats.last7Days} />
        <Card
          label="From signed-in customers"
          value={stats.signedIn}
          note={stats.total > 0 ? `${Math.round((stats.signedIn / stats.total) * 100)}%` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-base font-semibold text-forest-900">
            Most-chosen goal combinations
          </h2>
          <ul className="mt-3 flex flex-col gap-1.5">
            {stats.topCombos.map((combo) => (
              <li
                key={combo.goals}
                className="flex items-baseline justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="text-ink-900">{combo.goals}</span>
                <span className="font-ui font-semibold text-forest-900" data-numeric>
                  {combo.count}
                </span>
              </li>
            ))}
            {stats.topCombos.length === 0 && (
              <li className="text-sm text-ink-600">Nothing generated yet.</li>
            )}
          </ul>
        </section>

        <section>
          <h2 className="font-display text-base font-semibold text-forest-900">Per day</h2>
          <ul className="mt-3 flex flex-col gap-1.5">
            {stats.byDay.map((day) => (
              <li
                key={day.day}
                className="flex items-baseline justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="text-ink-900" data-numeric>
                  {day.day}
                </span>
                <span className="font-ui font-semibold text-forest-900" data-numeric>
                  {day.count}
                </span>
              </li>
            ))}
            {stats.byDay.length === 0 && <li className="text-sm text-ink-600">No data yet.</li>}
          </ul>
        </section>
      </div>

      {/*
        docs/15 §4 also asks for add-all conversion and most-swapped items. Neither is here, and
        the honest reason is that neither is recorded: swaps are client state by design (§1 step
        3) and add-all lands in the cart without a reference back to the protocol. Both need an
        event to exist before a number can be shown, and inventing one from cart contents would
        be a guess presented as a measurement.
      */}
      <p className="text-xs text-ink-600">
        Add-all conversion and most-swapped items are not shown: neither is recorded yet. Swaps
        never reach the server, and a cart carries no reference to the protocol it came from.
      </p>
    </div>
  );
}

function Card({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-forest-900" data-numeric>
        {value}
      </p>
      {note && <p className="text-xs text-ink-600">{note}</p>}
    </div>
  );
}
