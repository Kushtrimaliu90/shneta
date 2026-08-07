import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { pickLocale } from '@/lib/i18n';
import { listProducts } from '@/features/catalog/queries';
import {
  listQueryReport,
  listSearchRedirectRows,
  listSearchRules,
  listSynonymGroups,
} from '@/features/search/admin-queries';
import { SearchAdmin } from '@/features/search/components/search-admin';

export const metadata: Metadata = { title: 'Search' };

/**
 * docs/06 — the search console.
 *
 * The panel that makes search improvable rather than merely functional. Everything in `search_products`
 * was tuned by judgement until this existed; from here on it can be tuned by evidence — which queries
 * come back empty, and which come back full and get ignored.
 *
 * `search.view` opens it, because "what are people asking for that we don't sell" is a question support
 * hears first and should be able to answer without asking. `search.manage` is required to change
 * anything, and lands with the roles that own the catalogue.
 */
export default async function AdminSearchPage() {
  const profile = await getProfile();
  if (!can(profile?.role, 'search.view')) redirect('/admin');

  const canManage = can(profile?.role, 'search.manage');

  const [report, groups, rules, redirects, catalogue] = await Promise.all([
    listQueryReport(),
    listSynonymGroups(),
    listSearchRules(),
    listSearchRedirectRows(),
    /*
     * The product picker. `search_products` caps at 100 per call and the catalogue is under that, so
     * one page is the whole list — if it grows past 100 this becomes a typeahead rather than a select,
     * and the cap is the thing that will make that obvious rather than silently truncating.
     */
    listProducts({ sort: 'newest', locale: 'en' }),
  ]);

  const products = catalogue.items.map((item) => ({
    id: item.id,
    label: `${pickLocale(item.name, 'en')} — ${item.brandName}`,
  }));

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-forest-900">Search</h1>
      <p className="mt-1 max-w-3xl text-sm text-ink-600">
        What people search for, what they found, and what they clicked — plus the three levers that
        change it. Synonyms fix recall (“kolagjen” finding the collagen peptides), merchandising rules
        fix ranking, and redirects catch the queries that were never about a product.
      </p>

      <SearchAdmin
        report={report}
        groups={groups}
        rules={rules}
        redirects={redirects}
        products={products}
        canManage={canManage}
      />
    </div>
  );
}
