'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger';

/**
 * Last-resort boundary: it replaces the root layout, so it must render its own `html`/`body`
 * and cannot use next-intl (there is no request context left). Copy is bilingual inline —
 * the only place in the storefront where that is acceptable.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    logger.error('Root-level error boundary hit', { digest: error.digest });
  }, [error]);

  return (
    <html lang="sq">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#FAF9F5',
          color: '#1B1E1C',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', margin: 0, color: '#123227' }}>
            Diçka shkoi keq · Something went wrong
          </h1>
          <p style={{ marginTop: '0.75rem', color: '#565E59' }}>
            Provo ta rifreskosh faqen. · Please refresh the page.
          </p>
          {/*
            Deliberately a plain anchor, not next/link: this boundary fires when the root
            layout itself failed, so a client-side transition would re-enter the broken
            tree. A full document load is the recovery.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '1.5rem',
              background: '#1C4636',
              color: '#fff',
              padding: '0.75rem 1.5rem',
              borderRadius: 12,
              textDecoration: 'none',
            }}
          >
            BIOCODE
          </a>
        </div>
      </body>
    </html>
  );
}
