import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { pickLocale } from '@/lib/i18n';
import { clientEnv } from '@/lib/env.client';
import { getProfile } from '@/features/auth/queries';
import { can } from '@/features/admin/roles';
import { formatAdminDateTime } from '@/features/admin/copy';
import { PRODUCT_STATUS_LABELS } from '@/features/catalog/admin-copy';
import { getAdminProduct, getEditorOptions } from '@/features/catalog/admin-queries';
import { ProductEditor } from '@/features/catalog/components/product-editor';
import { ProductStatusControl } from '@/features/catalog/components/product-status-control';
import { cn } from '@/lib/utils';

type Props = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getAdminProduct((await params).id);
  return { title: product ? pickLocale(product.name, 'en') || product.slug : 'Product' };
}

const STATUS_TONES: Record<string, string> = {
  draft: 'bg-ink-600 text-white',
  pending_review: 'bg-warning text-white',
  published: 'bg-success text-white',
  archived: 'bg-error text-white',
};

/**
 * docs/06 §3 — the product editor.
 *
 * Two capabilities meet on this page and neither implies the other. A **product manager** edits
 * and submits for review; a **compliance manager** approves or rejects. Both may open it, and
 * each sees only their own controls — which is the workflow, not a UI nicety: docs/07 §10 exists
 * so the person who writes the health claims is not the person who clears them.
 *
 * The publish checklist is the page's most useful element. `guard_product_publish` will refuse
 * an incomplete product with one exception naming one missing thing; the checklist names all
 * four at once, so an editor fixes them in one pass instead of four round trips.
 */
export default async function AdminProductEditorPage({ params }: Props) {
  const [{ id }, profile] = await Promise.all([params, getProfile()]);

  const mayEdit = can(profile?.role, 'products.manage');
  const mayApprove = can(profile?.role, 'compliance.approve');
  if (!mayEdit && !mayApprove) redirect('/admin');

  const [product, options] = await Promise.all([getAdminProduct(id), getEditorOptions()]);
  if (!product) notFound();

  const name = pickLocale(product.name, 'en') || product.slug;

  return (
    <div>
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-ink-600 hover:text-forest-800"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All products
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-forest-900">{name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <span data-numeric>{product.slug}</span>
            {product.status === 'published' && (
              <Link
                href={`/en/product/${product.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 rounded-sm text-forest-800 underline underline-offset-4"
              >
                View on the site
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            )}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <span
            className={cn(
              'inline-flex items-center rounded-sm px-2 py-0.5 font-ui text-xs font-semibold',
              STATUS_TONES[product.status] ?? 'bg-ink-600 text-white',
            )}
          >
            {PRODUCT_STATUS_LABELS[product.status] ?? product.status}
          </span>
          {product.approvedAt && (
            <span className="text-xs text-ink-500" data-numeric>
              Approved {formatAdminDateTime(product.approvedAt).display}
            </span>
          )}
        </div>
      </div>

      {/*
        The checklist sits above everything because it answers the question an editor opens this
        page with — "what is still stopping this going live". Hidden once published, where it
        would just be four ticks nobody needs.
      */}
      {product.status !== 'published' && (
        <div className="mt-6 rounded-lg border border-line bg-surface p-4">
          <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
            Before this can be published
          </h2>
          {product.publishBlockers.length === 0 ? (
            <p className="mt-2 text-sm text-success">
              Everything is in place.{' '}
              {mayApprove ? 'Approve and publish below.' : 'Ready for compliance review.'}
            </p>
          ) : (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-600">
              {product.publishBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6">
        <ProductStatusControl
          productId={product.id}
          productName={pickLocale(product.name, 'en') || product.slug}
          status={product.status}
          blockers={product.publishBlockers}
          mayEdit={mayEdit}
          mayApprove={mayApprove}
        />
      </div>

      {mayEdit ? (
        <div className="mt-8">
          <ProductEditor
            product={product}
            brands={options.brands}
            categories={options.categories}
            goals={options.goals}
            ingredients={options.ingredients}
            certifications={options.certifications}
            /*
             * The bucket is public (migration 12), so admin thumbnails are a plain URL rather
             * than a signed one — signing 20 thumbnails per page render would be work for no
             * privacy gain when the storefront serves the same files unsigned.
             */
            imageBaseUrl={`${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images`}
          />
        </div>
      ) : (
        /*
          Compliance can read the claims but not rewrite them. Giving them the editor would
          collapse the separation the review workflow exists to create.
        */
        <div className="mt-8 max-w-3xl">
          <h2 className="font-ui text-xs font-semibold tracking-[0.08em] text-ink-500 uppercase">
            Claim-bearing fields
          </h2>
          <dl className="mt-3 flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 text-sm">
            {(
              [
                ['Description', product.description],
                ['How to use', product.howToUse],
                ['Warnings', product.warnings],
              ] as const
            ).map(([label, field]) => {
              /*
               * The raw `en` key, not `pickLocale(field, 'en')`.
               *
               * `pickLocale` falls back to Albanian when English is absent — correct for the
               * storefront, wrong here: it rendered the same paragraph twice and gave compliance
               * the impression a translation existed. What this view is for is reading the
               * claims in each language that will actually be published, so an absent
               * translation has to look absent.
               */
              const english = (field as Record<string, string | undefined>).en?.trim();

              return (
                <div key={label}>
                  <dt className="text-xs font-semibold tracking-wide text-ink-600 uppercase">
                    {label}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-ink-900">
                    <span className="mr-1 text-xs text-ink-500">sq</span>
                    {pickLocale(field, 'sq') || <span className="text-ink-500">—</span>}
                  </dd>
                  <dd className="mt-1 whitespace-pre-wrap text-ink-600">
                    <span className="mr-1 text-xs text-ink-500">en</span>
                    {english ?? <span className="text-ink-500">not translated</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </div>
  );
}
