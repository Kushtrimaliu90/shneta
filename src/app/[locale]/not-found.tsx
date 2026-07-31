import { getTranslations } from 'next-intl/server';
import { SearchX } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { buttonVariants } from '@/components/ui/button';

/**
 * docs/05 §16 — search box and popular categories arrive with M3, when there is a catalog
 * to point at. Until then the page keeps its single clear next action (docs/01 §7).
 */
export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <div className="container-page flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <SearchX className="size-10 text-forest-500" aria-hidden="true" />
      <h1 className="mt-6 font-display text-3xl font-semibold text-forest-900">{t('title')}</h1>
      <p className="mt-3 max-w-md text-ink-600">{t('body')}</p>
      <Link href="/" className={`${buttonVariants({ size: 'lg' })} mt-8`}>
        {t('cta')}
      </Link>
    </div>
  );
}
