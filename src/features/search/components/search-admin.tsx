'use client';

import { useActionState, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { pickLocale } from '@/lib/i18n';
import {
  deleteSearchRedirect,
  deleteSearchRule,
  deleteSynonymGroup,
  saveSearchRedirect,
  saveSearchRule,
  saveSynonymGroup,
  type SearchAdminState,
} from '@/features/search/admin-actions';
import type {
  QueryReportRow,
  SearchRedirectRow,
  SearchRuleRow,
  SynonymGroupRow,
} from '@/features/search/admin-queries';

/**
 * docs/06 — the search console.
 *
 * Four panels, in the order an operator actually works: **read the report**, then change something
 * because of it. Everything below the report exists to answer a specific line in it —
 *
 *   · a query with **zero results** wants a synonym group, or a product nobody stocks yet;
 *   · a query with results and **no clicks** wants a boost, a bury or a pin;
 *   · a query that is not about products at all wants a redirect.
 *
 * Admin UI is English-only in v1 (CLAUDE.md §3), so the strings here are literals rather than message
 * keys. The storefront strings this feature adds are translated; these are not.
 */

const TABS = ['report', 'synonyms', 'rules', 'redirects'] as const;
type Tab = (typeof TABS)[number];

/** There is no `<Select>` in the kit yet; matching `<Input>`'s box here keeps the forms even. */
const SELECT = 'h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink-900';

const TAB_LABEL: Record<Tab, string> = {
  report: 'Query report',
  synonyms: 'Synonyms',
  rules: 'Merchandising',
  redirects: 'Redirects',
};

function Feedback({ state }: { state: SearchAdminState }) {
  if (!state) return null;
  return state.ok ? (
    <Alert tone="success" className="mt-3">
      {state.data.message ?? 'Saved.'}
    </Alert>
  ) : (
    <Alert tone="error" className="mt-3">
      {state.error === 'admin.errors.forbidden'
        ? 'Your role cannot change search settings.'
        : state.error === 'admin.search.errors.duplicate'
          ? 'There is already a rule for that query.'
          : state.error === 'admin.search.errors.checkFields'
            ? 'Check the highlighted fields.'
            : 'Something went wrong. Try again.'}
    </Alert>
  );
}

/** A one-field delete, so a row can be removed without a form library. */
function DeleteButton({
  id,
  action,
  label,
}: {
  id: string;
  action: typeof deleteSynonymGroup;
  label: string;
}) {
  const [, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" aria-label={label}>
        <Trash2 className="size-4" aria-hidden="true" />
      </SubmitButton>
    </form>
  );
}

// -----------------------------------------------------------------------------

function ReportPanel({ rows }: { rows: QueryReportRow[] }) {
  /*
   * Zero-result queries are lifted out rather than left to be spotted in a column. They are the most
   * actionable rows on the screen — each one is a shopper who told you what they wanted in their own
   * words and got nothing — and buried in a 200-row table sorted by volume they would never be seen,
   * because a query that fails tends also to be a query few people repeat.
   */
  const zero = rows.filter((row) => row.zeroResults > 0).sort((a, b) => b.zeroResults - a.zeroResults);
  const noClicks = rows.filter((row) => row.searches >= 3 && row.clicks === 0 && row.zeroResults === 0);

  if (rows.length === 0) {
    return (
      <Alert tone="info" className="mt-4">
        No searches recorded yet. Every submitted search on the storefront lands here — query, result
        count, and whether anyone clicked a result.
      </Alert>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      {zero.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Found nothing</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-600">
              Each of these is a shopper describing what they wanted. Fix with a synonym group if the
              product exists under another name, or note it as a gap in the range.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {zero.slice(0, 40).map((row) => (
                <li
                  key={row.queryNorm}
                  className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1 text-sm"
                >
                  <span className="text-ink-900">{row.exampleQuery}</span>
                  <span className="text-xs text-ink-500" data-numeric>
                    ×{row.zeroResults}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {noClicks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Results, but nobody clicked</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-600">
              A ranking problem rather than a catalogue one: the products came back and none of them
              looked like the answer. A pin or a boost on the right product fixes it.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {noClicks.slice(0, 30).map((row) => (
                <li
                  key={row.queryNorm}
                  className="inline-flex items-center gap-2 rounded-sm border border-line px-2.5 py-1 text-sm"
                >
                  <span className="text-ink-900">{row.exampleQuery}</span>
                  <span className="text-xs text-ink-500" data-numeric>
                    ×{row.searches}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
              <th scope="col" className="py-2 pr-4 font-medium">Query</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Searches</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Zero</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Relaxed</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Clicks</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">CTR</th>
              <th scope="col" className="py-2 text-right font-medium">Avg results</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.queryNorm} className="border-b border-line/60">
                <td className="py-2 pr-4 text-ink-900">{row.exampleQuery}</td>
                <td className="py-2 pr-4 text-right" data-numeric>{row.searches}</td>
                <td className="py-2 pr-4 text-right" data-numeric>{row.zeroResults || '—'}</td>
                <td className="py-2 pr-4 text-right" data-numeric>{row.relaxedResults || '—'}</td>
                <td className="py-2 pr-4 text-right" data-numeric>{row.clicks}</td>
                <td className="py-2 pr-4 text-right" data-numeric>
                  {row.clickRatePct == null ? '—' : `${row.clickRatePct}%`}
                </td>
                <td className="py-2 text-right" data-numeric>{row.avgResults ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function SynonymsPanel({ groups, canManage }: { groups: SynonymGroupRow[]; canManage: boolean }) {
  const [state, formAction] = useActionState(saveSynonymGroup, null);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a group</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-600">
            One group per concept. If a product mentions any term in the group, every term is added to
            its search index — so “magnez”, “magnesium” and “magnezium” all find the same products.
            Saving re-indexes the whole catalogue, which takes a moment.
          </p>
          <p className="mt-2 text-sm text-ink-600">
            Avoid units and single letters. “mg” looks like a fine synonym for magnesium until
            “Vitamin C 500 mg” starts appearing under it.
          </p>

          <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              id="syn-label"
              label="Label"
              required
              errors={state?.ok === false ? state.fieldErrors?.label : undefined}
            >
              {(props) => <Input {...props} name="label" maxLength={60} placeholder="Magnesium" />}
            </Field>
            <Field id="syn-note" label="Note">
              {(props) => (
                <Input {...props} name="note" maxLength={300} placeholder="Why this exists" />
              )}
            </Field>
            <Field
              id="syn-terms"
              label="Terms"
              required
              hint="One per line, or comma separated. At least two."
              className="sm:col-span-2"
              errors={state?.ok === false ? state.fieldErrors?.terms : undefined}
            >
              {(props) => (
                <textarea
                  {...props}
                  name="terms"
                  rows={4}
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-forest-600"
                  placeholder={'magnez\nmagnesium\nmagnezium'}
                />
              )}
            </Field>
            <div className="sm:col-span-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-900">
                <input type="checkbox" name="isActive" defaultChecked className="size-4" />
                Active
              </label>
              <SubmitButton disabled={!canManage} loadingLabel="Saving…">
                Save group
              </SubmitButton>
            </div>
          </form>

          <Feedback state={state} />
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
              <th scope="col" className="py-2 pr-4 font-medium">Label</th>
              <th scope="col" className="py-2 pr-4 font-medium">Terms</th>
              <th scope="col" className="py-2 pr-4 font-medium">Active</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id} className="border-b border-line/60 align-top">
                <td className="py-2 pr-4 text-ink-900">{group.label}</td>
                <td className="py-2 pr-4 text-ink-600">{group.terms.join(', ')}</td>
                <td className="py-2 pr-4">{group.isActive ? 'Yes' : 'No'}</td>
                <td className="py-2 text-right">
                  {canManage && (
                    <DeleteButton
                      id={group.id}
                      action={deleteSynonymGroup}
                      label={`Delete ${group.label}`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function RulesPanel({
  rules,
  products,
  canManage,
}: {
  rules: SearchRuleRow[];
  products: { id: string; label: string }[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(saveSearchRule, null);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a rule</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-600">
            <strong>Pin</strong> forces a position. <strong>Boost</strong> and <strong>bury</strong>
            {' '}add to or subtract from the relevance score — a nudge, still beaten by a much better
            text match. <strong>Hide</strong> removes the product from results without unpublishing it.
          </p>
          <p className="mt-2 text-sm text-ink-600">
            Pins and boosts apply under relevance sorting only. A shopper who asked for cheapest-first
            has overruled you, and out-of-stock products stay below in-stock ones regardless.
          </p>

          <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              id="rule-product"
              label="Product"
              required
              errors={state?.ok === false ? state.fieldErrors?.productId : undefined}
            >
              {(props) => (
                <select {...props} name="productId" className={SELECT}>
                  <option value="">Choose…</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field id="rule-action" label="Action" required>
              {(props) => (
                <select {...props} name="action" className={SELECT}>
                  <option value="pin">Pin</option>
                  <option value="boost">Boost</option>
                  <option value="bury">Bury</option>
                  <option value="hide">Hide</option>
                </select>
              )}
            </Field>

            <Field id="rule-match" label="Applies to" required>
              {(props) => (
                <select {...props} name="matchType" defaultValue="exact" className={SELECT}>
                  <option value="exact">This exact query</option>
                  <option value="contains">Queries containing…</option>
                  <option value="any">Every search</option>
                </select>
              )}
            </Field>

            <Field
              id="rule-query"
              label="Query"
              errors={state?.ok === false ? state.fieldErrors?.query : undefined}
            >
              {(props) => <Input {...props} name="query" maxLength={120} placeholder="proteina" />}
            </Field>

            <Field
              id="rule-pin"
              label="Pin position"
              hint="1–100. Pins only."
              errors={state?.ok === false ? state.fieldErrors?.pinPosition : undefined}
            >
              {(props) => <Input {...props} name="pinPosition" type="number" min={1} max={100} />}
            </Field>

            <Field
              id="rule-weight"
              label="Weight"
              hint="Positive to boost, negative to bury."
              errors={state?.ok === false ? state.fieldErrors?.weight : undefined}
            >
              {(props) => (
                <Input {...props} name="weight" type="number" step="0.5" min={-99} max={99} />
              )}
            </Field>

            <Field id="rule-note" label="Note" className="sm:col-span-2">
              {(props) => (
                <Input {...props} name="note" maxLength={300} placeholder="Why this rule exists" />
              )}
            </Field>

            <div className="sm:col-span-2">
              <SubmitButton disabled={!canManage} loadingLabel="Saving…">
                Save rule
              </SubmitButton>
            </div>
          </form>

          <Feedback state={state} />
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
              <th scope="col" className="py-2 pr-4 font-medium">Query</th>
              <th scope="col" className="py-2 pr-4 font-medium">Action</th>
              <th scope="col" className="py-2 pr-4 font-medium">Product</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Value</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-line/60">
                <td className="py-2 pr-4 text-ink-900">
                  {rule.matchType === 'any' ? 'Every search' : rule.query}
                  {rule.matchType === 'contains' && (
                    <span className="ml-1 text-xs text-ink-500">(contains)</span>
                  )}
                </td>
                <td className="py-2 pr-4 capitalize">{rule.action}</td>
                <td className="py-2 pr-4 text-ink-600">{pickLocale(rule.productName, 'en')}</td>
                <td className="py-2 pr-4 text-right" data-numeric>
                  {rule.action === 'pin' ? `#${rule.pinPosition}` : rule.weight || '—'}
                </td>
                <td className="py-2 text-right">
                  {canManage && (
                    <DeleteButton
                      id={rule.id}
                      action={deleteSearchRule}
                      label={`Delete rule for ${rule.query ?? 'every search'}`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function RedirectsPanel({
  redirects,
  canManage,
}: {
  redirects: SearchRedirectRow[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(saveSearchRedirect, null);

  return (
    <div className="mt-4 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a redirect</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-600">
            Queries that want a page rather than a product list. “transporti” means the shipping page;
            answering it with an empty grid reads as “we don’t do that”.
          </p>
          <p className="mt-2 text-sm text-ink-600">
            Write the path without a locale prefix — <code>/legal/shipping-returns</code>, not
            {' '}<code>/en/legal/shipping-returns</code>. Both locales are handled from the one row.
          </p>

          <form action={formAction} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              id="red-query"
              label="Query"
              required
              errors={state?.ok === false ? state.fieldErrors?.query : undefined}
            >
              {(props) => (
                <Input {...props} name="query" maxLength={120} placeholder="transporti" />
              )}
            </Field>

            <Field id="red-match" label="Match" required>
              {(props) => (
                <select {...props} name="matchType" defaultValue="contains" className={SELECT}>
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                </select>
              )}
            </Field>

            <Field
              id="red-dest"
              label="Destination"
              required
              errors={state?.ok === false ? state.fieldErrors?.destinationPath : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  name="destinationPath"
                  maxLength={200}
                  placeholder="/legal/shipping-returns"
                />
              )}
            </Field>

            <Field id="red-note" label="Note">
              {(props) => <Input {...props} name="note" maxLength={300} />}
            </Field>

            <div className="sm:col-span-2">
              <SubmitButton disabled={!canManage} loadingLabel="Saving…">
                Save redirect
              </SubmitButton>
            </div>
          </form>

          <Feedback state={state} />
        </CardContent>
      </Card>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-500">
              <th scope="col" className="py-2 pr-4 font-medium">Query</th>
              <th scope="col" className="py-2 pr-4 font-medium">Match</th>
              <th scope="col" className="py-2 pr-4 font-medium">Destination</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {redirects.map((redirect) => (
              <tr key={redirect.id} className="border-b border-line/60">
                <td className="py-2 pr-4 text-ink-900">{redirect.query}</td>
                <td className="py-2 pr-4 capitalize">{redirect.matchType}</td>
                <td className="py-2 pr-4 text-ink-600">{redirect.destinationPath}</td>
                <td className="py-2 text-right">
                  {canManage && (
                    <DeleteButton
                      id={redirect.id}
                      action={deleteSearchRedirect}
                      label={`Delete redirect for ${redirect.query}`}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

export function SearchAdmin({
  report,
  groups,
  rules,
  redirects,
  products,
  canManage,
}: {
  report: QueryReportRow[];
  groups: SynonymGroupRow[];
  rules: SearchRuleRow[];
  redirects: SearchRedirectRow[];
  products: { id: string; label: string }[];
  canManage: boolean;
}) {
  const [tab, setTab] = useState<Tab>('report');

  return (
    <div className="mt-6">
      {!canManage && (
        <Alert tone="info" className="mb-4">
          You can read the report. Changing synonyms, ranking rules and redirects is catalogue work.
        </Alert>
      )}

      <div role="tablist" aria-label="Search console" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`search-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`search-panel-${name}`}
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

      <div role="tabpanel" id={`search-panel-${tab}`} aria-labelledby={`search-tab-${tab}`}>
        {tab === 'report' && <ReportPanel rows={report} />}
        {tab === 'synonyms' && <SynonymsPanel groups={groups} canManage={canManage} />}
        {tab === 'rules' && (
          <RulesPanel rules={rules} products={products} canManage={canManage} />
        )}
        {tab === 'redirects' && <RedirectsPanel redirects={redirects} canManage={canManage} />}
      </div>
    </div>
  );
}
